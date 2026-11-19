// Package server serves authenticated APIs and embedded browser assets.
package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/BaeKey/FRAME/internal/catalog"
	"github.com/BaeKey/FRAME/internal/state"
)

// MediaSource can resolve addresses only. Media bodies never enter the gateway.
type MediaSource interface {
	DownloadURL(context.Context, string) (string, error)
}

// Options contains only the settings consumed by the HTTP layer.
type Options struct {
	Logger      *slog.Logger
	LogLevel    string
	AccessToken string
	BasePath    string
	KeyTTL      time.Duration
}

type server struct {
	options  Options
	basePath string
	key      []byte
	source   MediaSource
	catalog  *catalog.Catalog
	assets   fs.FS
	state    *state.Manager
}

// New builds the HTTP handler. Dependencies are initialized by the caller and
// remain owned by the caller.
func New(options Options, key []byte, source MediaSource, assets fs.FS, index *catalog.Catalog, runtimeState *state.Manager) http.Handler {
	s := &server{options: options, basePath: options.BasePath, key: append([]byte(nil), key...), source: source, catalog: index, state: runtimeState, assets: assets}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/delete-plan", s.batchPlan)
	mux.HandleFunc("POST /api/delete-batch", s.batchDelete)
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("POST /api/logout", s.logout)
	mux.HandleFunc("GET /api/naming-rules", s.namingRules)
	mux.HandleFunc("POST /api/naming-rules/preview", s.previewNamingRules)
	mux.HandleFunc("GET /api/index", s.indexStatus)
	mux.HandleFunc("GET /api/cache-manifest", s.manifest)
	mux.HandleFunc("POST /api/index/refresh", s.refresh)
	mux.HandleFunc("POST /api/deletions/{id}/retry", s.retryDelete)
	mux.HandleFunc("GET /api/users", s.users)
	mux.HandleFunc("GET /api/users/{name}/items", s.items)
	mux.HandleFunc("GET /api/items/{id}", s.item)
	mux.HandleFunc("POST /api/session", s.session)
	mux.HandleFunc("GET /api/source/{id}", s.mediaSource)
	mux.HandleFunc("GET /api/stream/{id}", s.stream)
	mux.HandleFunc("GET /api/cover/{id}", s.cover)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "接口不存在") })
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			fail(w, 405, "方法不支持")
			return
		}
		s.static(w, r)
	})
	handler := s.observe(s.protect(mux), mux)
	if s.basePath == "" {
		return handler
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == s.basePath {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				fail(w, http.StatusMethodNotAllowed, "方法不支持")
				return
			}
			target := s.basePath + "/"
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusMovedPermanently)
			return
		}
		if !strings.HasPrefix(r.URL.Path, s.basePath+"/") {
			http.NotFound(w, r)
			return
		}
		r2 := r.Clone(r.Context())
		u := *r.URL
		u.Path = strings.TrimPrefix(r.URL.Path, s.basePath)
		r2.URL = &u
		handler.ServeHTTP(w, r2)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
