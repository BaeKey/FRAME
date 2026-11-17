package server

import (
	"log/slog"
	"net/http"
	"time"
)

func (s *server) logger() *slog.Logger {
	if s.options.Logger != nil {
		return s.options.Logger
	}
	return slog.Default()
}

type observedResponse struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *observedResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *observedResponse) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *observedResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += int64(n)
	return n, err
}

// Log route templates, never user-supplied URLs, query strings, headers or bodies.
// bytes is HTTP response bytes (JSON included), NOT necessarily media ciphertext.
func (s *server) observe(next http.Handler, routes *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		out := &observedResponse{ResponseWriter: w}
		completed := false
		defer func() {
			status := out.status
			if status == 0 {
				status = http.StatusOK
			}
			route := ""
			if routes != nil {
				_, route = routes.Handler(r)
			}
			if route == "" {
				route = "unmatched"
			}
			attrs := []any{"route", route, "status", status, "response_bytes", out.bytes, "duration_ms", time.Since(started).Milliseconds(), "completed", completed}
			if status >= 500 || !completed {
				s.logger().Error("http_request", attrs...)
			} else {
				s.logger().Debug("http_request", attrs...)
			}
		}()
		next.ServeHTTP(out, r)
		completed = true
	})
}
