package catalog

import (
	"context"
	"errors"

	"github.com/BaeKey/FRAME/internal/state"
	"github.com/BaeKey/FRAME/internal/storage"
)

// DeletePlan is the exact set of files a user must confirm before deletion.
type DeletePlan struct {
	Token      string   `json:"token"`
	Files      []Item   `json:"files"`
	Shared     bool     `json:"shared"`
	AutoCovers []string `json:"-"`
}

// DeleteResult reports remote outcomes, including partial failures.
type DeleteResult struct {
	Deleted []string `json:"deleted"`
	Failed  []string `json:"failed"`
}

func (c *Catalog) remove(ctx context.Context, id string, targets, all []storage.File) (DeleteResult, error) {
	result := DeleteResult{Deleted: []string{}, Failed: []string{}}
	remaining := []storage.File{}
	for _, f := range targets {
		if err := c.source.Remove(ctx, f.Path); err != nil {
			remaining = append(remaining, f)
			result.Failed = append(result.Failed, f.Name)

			continue
		}
		result.Deleted = append(result.Deleted, state.Hash(f.Path))
		deletePath := f.Path
		filtered := all[:0]
		for _, v := range all {
			if v.Path != deletePath {
				filtered = append(filtered, v)
			}
		}
		all = filtered
	}
	if len(remaining) > 0 {
		c.state.Pending(id, remaining)
	} else {
		c.state.ClearPending(id)
	}
	c.mu.Lock()
	c.publish(all)
	c.mu.Unlock()
	return result, nil
}

// Retry revalidates an in-memory deletion task before retrying its remaining files.
func (c *Catalog) Retry(ctx context.Context, id string) (DeleteResult, error) {
	c.operation.Lock()
	defer c.operation.Unlock()
	if err := ctx.Err(); err != nil {
		return DeleteResult{}, err
	}
	if err := c.ctx.Err(); err != nil {
		return DeleteResult{}, err
	}
	pending := c.state.PendingList()
	targets, ok := pending[id]
	if !ok {
		return DeleteResult{}, errors.New("重试记录不存在")
	}
	fresh, err := c.source.ListRefresh(ctx, true)
	if err != nil {
		return DeleteResult{}, err
	}
	byPath := map[string]storage.File{}
	for _, f := range fresh {
		byPath[f.Path] = f
	}
	remaining := []storage.File{}
	for _, f := range targets {
		v, exists := byPath[f.Path]
		if !exists {
			continue
		}
		if v.Size != f.Size || v.Modified != f.Modified {
			return DeleteResult{}, errors.New("待删除文件已变化，请人工核对")
		}

		remaining = append(remaining, v)
	}
	if len(remaining) == 0 {
		c.state.ClearPending(id)
		return DeleteResult{Deleted: []string{}, Failed: []string{}}, nil
	}
	ids := make([]string, 0, len(remaining))
	for _, f := range remaining {
		ids = append(ids, state.Hash(f.Path))
	}
	c.mu.Lock()
	snapshot := buildWithRules(fresh, c.compiled)
	c.mu.Unlock()
	plan, err := batchPlan(snapshot, ids)
	if err != nil {
		return DeleteResult{}, err
	}
	return c.executePlan(ctx, plan, fresh)
}
