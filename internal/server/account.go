package server

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const cookieName = "gateway_session"

func (s *server) sameOrigin(r *http.Request) bool {
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return r.Header.Get("Sec-Fetch-Site") == "same-origin"
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	scheme := "https"
	if s.localHTTP(r) {
		scheme = "http"
	}
	return u.Scheme == scheme && u.Host == r.Host && u.Path == "" && u.RawQuery == "" && u.Fragment == ""
}

// Public deployments always use HTTPS at the reverse proxy. Only loopback
// hostnames support plain HTTP for development; forwarding headers are ignored.
func (s *server) localHTTP(r *http.Request) bool {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	ip := net.ParseIP(host)
	return r.TLS == nil && (host == "localhost" || ip != nil && ip.IsLoopback())
}

func (s *server) cookie(w http.ResponseWriter, r *http.Request, raw string, expires time.Time) {
	maxAge := int(time.Until(expires).Seconds())
	if raw == "" {
		maxAge = -1
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: raw, Path: "/", HttpOnly: true, Secure: !s.localHTTP(r), SameSite: http.SameSiteStrictMode, MaxAge: maxAge, Expires: expires})
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		fail(w, 500, "建立会话失败")
		return
	}
	value := base64.RawURLEncoding.EncodeToString(raw)
	expires := time.Now().Add(30 * 24 * time.Hour)
	s.state.CreateSession(value, s.options.AccessToken, expires)
	if old, err := r.Cookie(cookieName); err == nil {
		s.state.Logout(old.Value)
	}
	s.cookie(w, r, value, expires)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		s.state.Logout(c.Value)
	}
	s.cookie(w, r, "", time.Unix(1, 0))
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *server) cookieAuth(w http.ResponseWriter, r *http.Request) bool {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	if !s.state.Session(c.Value, s.options.AccessToken) {
		return false
	}
	expires := time.Now().Add(30 * 24 * time.Hour)
	s.state.Renew(c.Value, expires)
	s.cookie(w, r, c.Value, expires)
	return true
}

func (s *server) protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		// Provider/CDN hosts are dynamic. Only fetch connections are widened;
		// scripts and the virtual decrypted video endpoint remain same-origin.
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self' https: http:; img-src 'self' blob:; media-src 'self' blob:; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
			w.Header().Set("Cache-Control", "no-store")
			supplied := sha256.Sum256([]byte(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")))
			expected := sha256.Sum256([]byte(s.options.AccessToken))
			bearer := strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") && subtle.ConstantTimeCompare(supplied[:], expected[:]) == 1
			if r.Method != "GET" && r.Method != "HEAD" && (!bearer || r.Header.Get("Origin") != "") && !s.sameOrigin(r) {
				fail(w, 403, "禁止跨站操作")
				return
			}
			if !bearer && (r.URL.Path == "/api/login" || !s.cookieAuth(w, r)) {
				w.Header().Set("WWW-Authenticate", "Bearer")
				fail(w, 401, "访问令牌无效")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) session(w http.ResponseWriter, r *http.Request) {
	level := s.options.LogLevel
	if level == "" {
		level = "info"
	}
	writeJSON(w, 200, map[string]string{"log_level": level, "key_base64": base64.StdEncoding.EncodeToString(s.key), "expires_at": time.Now().Add(s.options.KeyTTL).UTC().Format(time.RFC3339Nano)})
}
