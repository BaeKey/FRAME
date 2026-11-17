package catalog

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/BaeKey/FRAME/internal/state"
	"github.com/BaeKey/FRAME/internal/storage"
)

type testSource struct {
	lists atomic.Int32
	files []storage.File
}

func (s *testSource) ListRefresh(context.Context, bool) ([]storage.File, error) {
	s.lists.Add(1)
	return append([]storage.File(nil), s.files...), nil
}
func (s *testSource) Remove(context.Context, string) error { return nil }

func TestEnsureLoadsInitialCatalogIntoMemory(t *testing.T) {
	source := &testSource{files: []storage.File{{Path: "alice/alice_20261117-120000.jpg", Name: "alice_20261117-120000.jpg", Size: 12}}}
	catalog, err := New(source, nil, state.New(), "source", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()

	if err := catalog.Ensure(); err != nil {
		t.Fatal(err)
	}
	if got := source.lists.Load(); got != 1 {
		t.Fatalf("expected one OpenList scan, got %d", got)
	}
	if status := catalog.Status(); !status.Initialized || status.Updated == "" {
		t.Fatalf("catalog should be initialized after Ensure: %+v", status)
	}
	if got := len(catalog.Snapshot().Items); got != 1 {
		t.Fatalf("expected one indexed item, got %d", got)
	}

	if err := catalog.Ensure(); err != nil {
		t.Fatal(err)
	}
	if got := source.lists.Load(); got != 1 {
		t.Fatalf("unexpected rescan before interval, got %d scans", got)
	}
}
