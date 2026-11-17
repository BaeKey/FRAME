package server

import (
	"net/http"
	"net/url"
	"time"

	"github.com/BaeKey/FRAME/internal/catalog"
)

// sourceURL only resolves an indexed file's temporary URL, regardless of format.
// There is deliberately no media-body read capability in the HTTP server.
func (s *server) sourceURL(w http.ResponseWriter, r *http.Request, item catalog.Item) (string, bool) {
	started := time.Now()
	s.logger().Debug("media_source_resolving", "item_id", item.ID, "media_type", item.Type)
	raw, err := s.source.DownloadURL(r.Context(), item.Path)
	u, parseErr := url.Parse(raw)
	if err != nil || parseErr != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
		s.logger().Error("media_source_failed", "item_id", item.ID, "media_type", item.Type, "transport", "browser_direct", "cipher_bytes", 0)
		fail(w, 502, "无法获取网盘文件直链")
		return "", false
	}
	s.logger().Debug("media_source_resolved", "item_id", item.ID, "media_type", item.Type, "provider_host", u.Host, "duration_ms", time.Since(started).Milliseconds())
	return u.String(), true
}

func (s *server) issueSource(w http.ResponseWriter, r *http.Request, item catalog.Item, redirect bool) {
	raw, ok := s.sourceURL(w, r, item)
	if !ok {
		return
	}
	u, _ := url.Parse(raw)
	delivery := "json"
	if redirect {
		delivery = "redirect_302"
	}
	s.logger().Debug("media_source_issued", "item_id", item.ID, "media_type", item.Type, "transport", "browser_direct", "delivery", delivery, "provider_host", u.Host, "cipher_bytes", 0, "decrypt_location", "browser")
	if redirect {
		w.Header().Set("Location", raw)
		w.WriteHeader(http.StatusFound)
		return
	}
	writeJSON(w, 200, map[string]any{"url": raw, "size": item.Size})
}

func (s *server) mediaSource(w http.ResponseWriter, r *http.Request) {
	if item, ok := s.find(w, r); ok {
		s.issueSource(w, r, item, false)
	}
}

// All indexed formats redirect. No Range validation or proxy fallback in Go.
func (s *server) stream(w http.ResponseWriter, r *http.Request) {
	if item, ok := s.find(w, r); ok {
		s.issueSource(w, r, item, true)
	}
}

func (s *server) cover(w http.ResponseWriter, r *http.Request) {
	item, ok := s.find(w, r)
	if !ok {
		return
	}
	if item.CoverID == "" {
		s.asset(w, r, "static/placeholder.svg") // Bundled UI asset, not a storage file.
		return
	}
	cover, ok := s.catalog.Snapshot().Files[item.CoverID]
	if !ok {
		fail(w, 404, "封面不存在")
		return
	}
	s.issueSource(w, r, cover, true)
}
