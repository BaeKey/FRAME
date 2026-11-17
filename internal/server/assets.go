package server

import (
	"io/fs"
	"net/http"
	"strconv"
	"strings"
)

func (s *server) asset(w http.ResponseWriter, r *http.Request, name string) {
	if !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}
	content, err := fs.ReadFile(s.assets, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	switch {
	case strings.HasSuffix(name, ".js"):
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	case strings.HasSuffix(name, ".css"):
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case strings.HasSuffix(name, ".svg"):
		w.Header().Set("Content-Type", "image/svg+xml")
	default:
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(content)))
	if r.Method != http.MethodHead {
		_, _ = w.Write(content)
	}
}

func (s *server) static(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	if name != "index.html" && name != "sw.js" && !strings.HasPrefix(name, "assets/") && !strings.HasPrefix(name, "static/") {
		http.NotFound(w, r)
		return
	}
	if !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	if name == "sw.js" {
		w.Header().Set("Service-Worker-Allowed", "/")
	}
	s.asset(w, r, name)
}
