package catalog

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/BaeKey/FRAME/internal/state"
	"github.com/BaeKey/FRAME/internal/storage"
)

const MaxBatch = 200

// Deletion plans include an unshared cover when a video is selected. AutoCovers
// are omitted from JSON because they describe execution dependencies, not UI data.
func batchPlan(snapshot *Snapshot, ids []string) (DeletePlan, error) {
	if snapshot == nil || len(ids) == 0 || len(ids) > MaxBatch {
		return DeletePlan{}, errors.New("请选择 1–200 个文件")
	}
	selected := map[string]bool{}
	p := DeletePlan{Files: []Item{}, AutoCovers: []string{}}
	for _, id := range ids {
		item, ok := snapshot.Files[id]
		if !ok || selected[id] {
			return DeletePlan{}, errors.New("选择包含无效或重复文件")
		}
		selected[id] = true
		p.Files = append(p.Files, item)
	}

	videoOwners := map[string][]string{}
	for _, item := range snapshot.Items {
		if item.Type == "video" && item.CoverID != "" && item.CoverID != item.ID {
			videoOwners[item.CoverID] = append(videoOwners[item.CoverID], item.ID)
		}
	}
	for _, item := range append([]Item(nil), p.Files...) {
		if item.Type != "video" || item.CoverID == "" || item.CoverID == item.ID {
			continue
		}
		shared := false
		for _, ownerID := range videoOwners[item.CoverID] {
			if !selected[ownerID] {
				shared = true
				break
			}
		}
		if shared {
			if !selected[item.CoverID] {
				p.Shared = true
			}
			continue
		}
		if !selected[item.CoverID] {
			cover, ok := snapshot.Files[item.CoverID]
			if ok && cover.Type == "image" {
				selected[item.CoverID] = true
				p.Files = append(p.Files, cover)
				p.AutoCovers = append(p.AutoCovers, item.CoverID)
			}
		}
	}
	sort.Strings(p.AutoCovers)
	sort.Slice(p.Files, func(i, j int) bool { return p.Files[i].ID < p.Files[j].ID })
	var text strings.Builder
	for _, item := range p.Files {
		text.WriteString(item.ID)
		text.WriteString(item.Version)
	}
	p.Token = state.Hash(text.String())
	return p, nil
}
func (c *Catalog) BatchPlan(ids []string) (DeletePlan, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return batchPlan(c.snapshot, ids)
}

func (c *Catalog) DeleteBatch(ctx context.Context, ids []string, token string) (DeleteResult, error) {
	c.operation.Lock()
	defer c.operation.Unlock()
	if err := ctx.Err(); err != nil {
		return DeleteResult{}, err
	}
	if err := c.ctx.Err(); err != nil {
		return DeleteResult{}, err
	}
	c.mu.Lock()
	p, err := batchPlan(c.snapshot, ids)
	c.mu.Unlock()
	if err != nil || p.Token != token {
		return DeleteResult{}, errors.New("清单变化，请重新确认")
	}
	fresh, err := c.source.ListRefresh(ctx, true)
	if err != nil {
		return DeleteResult{}, err
	}
	return c.executePlan(ctx, p, fresh)
}

// executePlan removes selected videos before their automatically paired covers.
// A cover is deleted only after all videos in the plan that use it succeeded.
func (c *Catalog) executePlan(ctx context.Context, p DeletePlan, fresh []storage.File) (DeleteResult, error) {
	result := DeleteResult{Deleted: []string{}, Failed: []string{}}
	byPath := make(map[string]storage.File, len(fresh))
	for _, f := range fresh {
		byPath[f.Path] = f
	}
	for _, item := range p.Files {
		f, ok := byPath[item.Path]
		if !ok || f.Size != item.Size || f.Modified != item.Modified {
			return result, errors.New("文件发生变化，请重新确认")
		}
	}
	autoCover := map[string]bool{}
	for _, id := range p.AutoCovers {
		autoCover[id] = true
	}
	deletedSet := map[string]bool{}
	deleteOne := func(item Item) error {
		f, ok := byPath[item.Path]
		if !ok {
			return nil
		}
		taskID := state.Hash(f.Path)
		c.state.Pending(taskID, []storage.File{f})
		current, err := c.remove(ctx, taskID, []storage.File{f}, append([]storage.File(nil), fresh...))
		result.Deleted = append(result.Deleted, current.Deleted...)
		result.Failed = append(result.Failed, current.Failed...)
		if err != nil {
			return err
		}
		if len(current.Deleted) > 0 {
			deletedSet[item.ID] = true
			delete(byPath, f.Path)
			kept := fresh[:0]
			for _, existing := range fresh {
				if existing.Path != f.Path {
					kept = append(kept, existing)
				}
			}
			fresh = kept
		}
		return nil
	}

	// Delete videos first, then explicitly selected non-cover files.
	for _, item := range p.Files {
		if item.Type == "video" {
			if err := deleteOne(item); err != nil {
				return result, err
			}
		}
	}
	for _, item := range p.Files {
		if item.Type != "video" && !autoCover[item.ID] {
			if err := deleteOne(item); err != nil {
				return result, err
			}
		}
	}
	// Only remove an auto-added cover if every planned video using it was removed.
	for _, item := range p.Files {
		if !autoCover[item.ID] {
			continue
		}
		allOwnersDeleted := true
		for _, owner := range p.Files {
			if owner.Type == "video" && owner.CoverID == item.ID && !deletedSet[owner.ID] {
				allOwnersDeleted = false
				break
			}
		}
		if allOwnersDeleted {
			if err := deleteOne(item); err != nil {
				return result, err
			}
		}
	}
	return result, nil
}
