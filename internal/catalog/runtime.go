package catalog

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/BaeKey/FRAME/internal/state"
	"github.com/BaeKey/FRAME/internal/storage"
)

// Source is the directory and deletion capability required by the catalog.
// Media downloads are deliberately not part of this interface.
type Source interface {
	ListRefresh(context.Context, bool) ([]storage.File, error)
	Remove(context.Context, string) error
}

// Catalog publishes in-memory snapshots from the OpenList file listing.
// Callers must not modify snapshots returned by Snapshot.
type Catalog struct {
	rules     []NamingRule
	compiled  []compiledRule
	source    Source
	state     *state.Manager
	namespace string
	interval  time.Duration

	// operation serializes scans and remote deletions. Acquire it before mu.
	operation           sync.Mutex
	mu                  sync.Mutex
	snapshot            *Snapshot
	updated, checked    time.Time
	revision, lastError string
	scanning, closed    bool
	ctx                 context.Context
	cancel              context.CancelFunc
	workers             sync.WaitGroup
}

// Status describes the most recent index update.
type Status struct {
	Scanning    bool   `json:"scanning"`
	Initialized bool   `json:"initialized"`
	Updated     string `json:"updated"`
	Error       string `json:"error"`
	Revision    string `json:"revision"`
}

// New creates an in-memory catalog using naming rules loaded from configuration.
func New(source Source, rules []NamingRule, runtimeState *state.Manager, namespace string, interval time.Duration) (*Catalog, error) {
	if runtimeState == nil {
		return nil, fmt.Errorf("runtime state is required")
	}
	if rules == nil {
		rules = DefaultRules()
	}
	compiled, err := compileRules(rules)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Catalog{
		rules: append([]NamingRule(nil), rules...), compiled: compiled,
		source: source, state: runtimeState, namespace: namespace,
		interval: interval, ctx: ctx, cancel: cancel,
	}, nil
}

func (c *Catalog) decorate() {
	for id, item := range c.snapshot.Files {
		item.Version = state.Hash(fmt.Sprintf("%s:%s:%d:%s", c.namespace, item.Path, item.Size, item.Modified))
		if item.Modified == "" {
			item.Version = state.Hash(item.Version + c.revision)
		}
		c.snapshot.Files[id] = item
	}
	for i, item := range c.snapshot.Items {
		item = c.snapshot.Files[item.ID]
		if item.CoverID != "" {
			cover := c.snapshot.Files[item.CoverID]
			item.CoverVersion = cover.Version
		}
		c.snapshot.Items[i] = item
		c.snapshot.Files[item.ID] = item
	}
	coverItems := make(map[string]Item, len(c.snapshot.Items))
	for _, item := range c.snapshot.Items {
		if item.CoverID != "" {
			coverItems[item.CoverURL] = item
		}
	}
	for i, u := range c.snapshot.Users {
		if item, ok := coverItems[u.CoverURL]; ok {
			u.CoverVersion = item.CoverVersion
			u.CoverFileID = item.CoverID
		}
		c.snapshot.Users[i] = u
	}
}

// Snapshot returns the current read-only index without contacting storage.
func (c *Catalog) Snapshot() *Snapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.snapshot == nil {
		return Build(nil)
	}
	return c.snapshot
}

// Close prevents new scans, cancels the active scan and waits for it to finish.
// Wait for any in-flight deletion before shutdown completes.
func (c *Catalog) Close() {
	c.mu.Lock()
	c.closed = true
	c.cancel()
	c.mu.Unlock()
	c.workers.Wait()
	// Wait for any in-flight deletion before shutdown completes.
	c.operation.Lock()
	c.operation.Unlock()
}

// Status reports the last completed scan and any active update.
func (c *Catalog) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.statusLocked()
}

func (c *Catalog) statusLocked() Status {
	st := Status{Scanning: c.scanning, Initialized: c.snapshot != nil, Error: c.lastError, Revision: c.revision}
	if !c.updated.IsZero() {
		st.Updated = c.updated.Format(time.RFC3339)
	}
	return st
}

// Ensure builds the initial in-memory snapshot before serving catalog data.
// Later navigations trigger a background refresh only after the configured interval.
func (c *Catalog) Ensure() error {
	c.operation.Lock()
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		c.operation.Unlock()
		return fmt.Errorf("索引已关闭")
	}
	if c.snapshot != nil {
		c.mu.Unlock()
		c.operation.Unlock()
		c.Trigger(false)
		return nil
	}
	c.scanning = true
	c.checked = time.Now()
	c.mu.Unlock()

	ctx, cancel := context.WithTimeout(c.ctx, 15*time.Minute)
	defer cancel()
	started := time.Now()
	slog.Debug("catalog_scan_started", "force", false)
	files, err := c.source.ListRefresh(ctx, false)
	c.mu.Lock()
	if err != nil {
		c.lastError = "更新失败，请检查存储连接或权限"
		c.scanning = false
		c.mu.Unlock()
		c.operation.Unlock()
		slog.Error("catalog_scan_failed", "duration_ms", time.Since(started).Milliseconds())
		return err
	}
	c.publish(files)
	c.scanning = false
	c.mu.Unlock()
	c.operation.Unlock()
	slog.Info("catalog_scan_completed", "files", len(files), "duration_ms", time.Since(started).Milliseconds())
	return nil
}

// Trigger is called only on navigation or an explicit refresh. There is no timer.
func (c *Catalog) Trigger(force bool) Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed && !c.scanning && (force || time.Since(c.checked) >= c.interval) {
		c.scanning = true
		c.checked = time.Now()
		c.lastError = ""
		c.workers.Add(1)
		go c.scan(force)
	}
	return c.statusLocked()
}

func (c *Catalog) scan(force bool) {
	defer c.workers.Done()
	c.operation.Lock()
	defer c.operation.Unlock()
	ctx, cancel := context.WithTimeout(c.ctx, 15*time.Minute)
	defer cancel()
	started := time.Now()
	slog.Debug("catalog_scan_started", "force", force)
	files, err := c.source.ListRefresh(ctx, force)
	c.mu.Lock()
	defer c.mu.Unlock()
	defer func() { c.scanning = false }()
	if err != nil {
		c.lastError = "更新失败，保留上次索引；请检查存储连接或权限"
		slog.Error("catalog_scan_failed", "duration_ms", time.Since(started).Milliseconds())
	} else {
		c.publish(files)
		slog.Info("catalog_scan_completed", "files", len(files), "duration_ms", time.Since(started).Milliseconds())
	}
}

// publish replaces the in-memory snapshot; callers hold operation and mu.
func (c *Catalog) publish(files []storage.File) {
	now := time.Now()
	revision := fmt.Sprint(now.UnixNano())
	c.snapshot = buildWithRules(files, c.compiled)
	c.updated = now
	c.revision = revision
	c.decorate()
}

func (c *Catalog) NamingRules() []NamingRule {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]NamingRule{}, c.rules...)
}

func PreviewNaming(rules []NamingRule, name string) (Item, error) {
	compiled, err := compileRules(rules)
	if err != nil {
		return Item{}, err
	}
	snapshot := buildWithRules([]storage.File{{Path: name, Name: name}}, compiled)
	return snapshot.Items[0], nil
}
