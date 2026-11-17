package server

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/BaeKey/FRAME/internal/catalog"
)

func (s *server) indexStatus(w http.ResponseWriter, r *http.Request) {
	pending := s.state.PendingList()
	tasks := []map[string]any{}
	snapshot := s.catalog.Snapshot()
	itemsByPath := make(map[string]catalog.Item, len(snapshot.Files))
	for _, item := range snapshot.Files {
		itemsByPath[item.Path] = item
	}
	for id, files := range pending {
		ids := []string{}
		for _, f := range files {
			if item, ok := itemsByPath[f.Path]; ok {
				ids = append(ids, item.ID)
			}
		}
		plan, planErr := s.catalog.BatchPlan(ids)
		filesForUI := []map[string]string{}
		shared := false
		if planErr == nil {
			shared = plan.Shared
			for _, item := range plan.Files {
				filesForUI = append(filesForUI, map[string]string{"name": item.Name, "type": item.Type})
			}
		} else {
			for _, f := range files {
				filesForUI = append(filesForUI, map[string]string{"name": f.Name, "type": "unknown"})
			}
		}
		tasks = append(tasks, map[string]any{"id": id, "files": filesForUI, "shared": shared})
	}
	writeJSON(w, 200, map[string]any{"index": s.catalog.Status(), "pending": tasks})
}

func (s *server) refresh(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 202, s.catalog.Trigger(r.URL.Query().Get("force") == "true"))
}

func (s *server) retryDelete(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	s.logger().Info("delete_started", "operation", "retry")
	result, err := s.catalog.Retry(r.Context(), r.PathValue("id"))
	s.logDeleteResult("retry", started, result, err)
	if err != nil {
		fail(w, 409, "重试未完成，请检查文件变化或删除权限")
		return
	}
	writeJSON(w, 200, result)
}

func (s *server) manifest(w http.ResponseWriter, r *http.Request) {
	snapshot := s.catalog.Snapshot()
	files := map[string]string{}
	for id, item := range snapshot.Files {
		files[id] = item.Version
	}
	writeJSON(w, 200, map[string]any{"files": files})
}

type batchRequest struct {
	IDs   []string `json:"ids"`
	Token string   `json:"token"`
}

func readBatch(w http.ResponseWriter, r *http.Request) (batchRequest, bool) {
	var input batchRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || len(input.IDs) == 0 || len(input.IDs) > catalog.MaxBatch {
		fail(w, 400, "请选择 1–200 个文件")
		return input, false
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		fail(w, 400, "请求格式无效")
		return input, false
	}
	return input, true
}

func (s *server) batchPlan(w http.ResponseWriter, r *http.Request) {
	input, ok := readBatch(w, r)
	if !ok {
		return
	}
	p, err := s.catalog.BatchPlan(input.IDs)
	if err != nil {
		fail(w, 409, "文件不存在或选择重复，请刷新列表")
		return
	}
	writeJSON(w, 200, p)
}

func (s *server) batchDelete(w http.ResponseWriter, r *http.Request) {
	input, ok := readBatch(w, r)
	if !ok {
		return
	}
	if len(input.Token) != 64 {
		fail(w, 400, "请先确认删除清单")
		return
	}
	started := time.Now()
	s.logger().Info("delete_started", "operation", "batch", "selected_count", len(input.IDs), "item_ids", input.IDs)
	result, err := s.catalog.DeleteBatch(r.Context(), input.IDs, input.Token)
	s.logDeleteResult("batch", started, result, err)
	if err != nil {
		writeJSON(w, 409, map[string]any{"error": "删除未全部完成，文件可能变化或存储不可用；请刷新并检查待清理记录", "deleted": result.Deleted, "failed": result.Failed})
		return
	}
	writeJSON(w, 200, result)
}

func (s *server) users(w http.ResponseWriter, r *http.Request) {
	if err := s.catalog.Ensure(); err != nil {
		fail(w, 502, "无法读取 OpenList 媒体清单")
		return
	}
	snapshot := s.catalog.Snapshot()
	writeJSON(w, 200, map[string]any{"users": snapshot.Users, "unrecognized": snapshot.Unrecognized, "index": s.catalog.Status()})
}

func (s *server) items(w http.ResponseWriter, r *http.Request) {
	if err := s.catalog.Ensure(); err != nil {
		fail(w, 502, "无法读取 OpenList 媒体清单")
		return
	}
	order := r.URL.Query().Get("sort")
	if order == "" {
		order = "desc"
	}
	if order != "asc" && order != "desc" {
		fail(w, 400, "sort 必须为 asc 或 desc")
		return
	}
	snapshot := s.catalog.Snapshot()
	writeJSON(w, 200, map[string]any{"items": snapshot.ForUser(r.PathValue("name"), order), "index": s.catalog.Status()})
}

func (s *server) find(w http.ResponseWriter, r *http.Request) (catalog.Item, bool) {
	snapshot := s.catalog.Snapshot()
	item, ok := snapshot.Files[r.PathValue("id")]
	if !ok {
		fail(w, 404, "文件不存在")
	}
	return item, ok
}

func (s *server) item(w http.ResponseWriter, r *http.Request) {
	item, ok := s.find(w, r)
	if ok {
		writeJSON(w, 200, item)
	}
}

// Result logs are operational events, not media traffic. Never include raw errors,
// paths, file names, confirmation tokens, or provider URLs.
func (s *server) logDeleteResult(operation string, started time.Time, result catalog.DeleteResult, err error) {
	outcome := "success"
	if len(result.Failed) > 0 {
		outcome = "partial_failure"
	}
	if err != nil {
		outcome = "failed"
	}
	s.logger().Info("delete_finished", "operation", operation, "outcome", outcome, "deleted_count", len(result.Deleted), "failed_count", len(result.Failed), "deleted_ids", result.Deleted, "duration_ms", time.Since(started).Milliseconds())
	if err != nil || len(result.Failed) > 0 {
		s.logger().Error("delete_failed", "operation", operation, "deleted_count", len(result.Deleted), "failed_count", len(result.Failed), "reason", "validation_storage_or_persistence")
	}
}
