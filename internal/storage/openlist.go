// Package storage accesses original ciphertext through the OpenList API.
package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"
)

// ErrUnavailable is intentionally redacted: upstream errors can contain credentials.
var ErrUnavailable = errors.New("存储不可用")

// File contains metadata and a path relative to the ciphertext root.
type File struct {
	Path     string
	Name     string
	Size     int64
	Modified string
}

// OpenList manages login tokens and ciphertext access. It is safe for concurrent use.
type OpenList struct {
	baseURL, root      string
	client             *http.Client
	username, password string
	authMu             sync.Mutex
	token              string
	generation         uint64
}

// New creates an OpenList client without performing network I/O.
func New(base, username, password, root string) *OpenList {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	return &OpenList{baseURL: base, root: root, username: username, password: password,
		client: &http.Client{Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			// This client only calls the control-plane API. Never follow redirects
			// into a media download or forward login bodies/credentials elsewhere.
			return errors.New("API redirect refused")
		}},
	}
}

var errUnauthorized = errors.New("upstream authentication required")

// request never exposes the upstream error message, request body or raw URL.
func (s *OpenList) request(ctx context.Context, endpoint string, body any, token string, data any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return ErrUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, "POST", s.baseURL+endpoint, bytes.NewReader(b))
	if err != nil {
		return ErrUnavailable
	}
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return errUnauthorized
	}
	if resp.StatusCode != http.StatusOK {
		return ErrUnavailable
	}
	var envelope struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 32<<20)).Decode(&envelope); err != nil {
		return ErrUnavailable
	}
	if envelope.Code == http.StatusUnauthorized {
		return errUnauthorized
	}
	if envelope.Code != 200 {
		return ErrUnavailable
	}
	if data == nil {
		return nil
	}
	if err = json.Unmarshal(envelope.Data, data); err != nil {
		return ErrUnavailable
	}
	return nil
}

// Serialize login and refresh. Generation, rather than token text, avoids duplicate
// refreshes when OpenList reissues the same token to concurrent requests.
func (s *OpenList) credentials(ctx context.Context, staleGeneration uint64, refresh bool) (string, uint64, error) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	if err := ctx.Err(); err != nil {
		return "", 0, ErrUnavailable
	}
	if s.token != "" && (!refresh || s.generation != staleGeneration) {
		return s.token, s.generation, nil
	}
	s.token = ""
	var login struct {
		Token string `json:"token"`
	}
	if err := s.request(ctx, "/api/auth/login", map[string]string{"username": s.username, "password": s.password}, "", &login); err != nil || strings.TrimSpace(login.Token) == "" {
		return "", 0, ErrUnavailable
	}
	s.token = login.Token
	s.generation++
	return s.token, s.generation, nil
}

func (s *OpenList) call(ctx context.Context, endpoint string, body any, data any) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	token, generation, err := s.credentials(ctx, 0, false)
	if err != nil {
		return ErrUnavailable
	}
	err = s.request(ctx, endpoint, body, token, data)
	if errors.Is(err, errUnauthorized) {
		token, _, err = s.credentials(ctx, generation, true)
		if err != nil {
			return ErrUnavailable
		}
		// Only retry once: bad credentials or revoked access must not loop forever.
		err = s.request(ctx, endpoint, body, token, data)
	}
	if err != nil {
		return ErrUnavailable
	}
	return nil
}

func safeName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\\\x00")
}

func (s *OpenList) absolute(relative string) (string, error) {
	if relative == "" || strings.HasPrefix(relative, "/") || path.Clean(relative) != relative || strings.ContainsAny(relative, "\\\x00") || relative == ".." || strings.HasPrefix(relative, "../") {
		return "", ErrUnavailable
	}
	return s.root + "/" + relative, nil
}

// ListRefresh recursively lists files, optionally refreshing each directory.
func (s *OpenList) ListRefresh(ctx context.Context, refresh bool) ([]File, error) {
	files := []File{}
	dirs := []string{""}
	count := 0
	for len(dirs) > 0 {
		rel := dirs[0]
		dirs = dirs[1:]
		count++
		if count > 10000 {
			return nil, ErrUnavailable
		}
		dir := s.root
		if rel != "" {
			dir += "/" + rel
		}
		seen := map[string]bool{}
		for page := 1; ; page++ {
			var data struct {
				Content []struct {
					Name     string `json:"name"`
					Modified string `json:"modified"`
					Size     int64  `json:"size"`
					IsDir    bool   `json:"is_dir"`
				} `json:"content"`
				Total int `json:"total"`
			}
			if err := s.call(ctx, "/api/fs/list", map[string]any{"path": dir, "password": "", "page": page, "per_page": 1000, "refresh": refresh && page == 1}, &data); err != nil {
				return nil, err
			}
			if len(data.Content) == 0 {
				if len(seen) < data.Total {
					return nil, ErrUnavailable
				}
				break
			}
			for _, f := range data.Content {
				if !safeName(f.Name) || seen[f.Name] || f.Size < 0 {
					return nil, ErrUnavailable
				}
				seen[f.Name] = true
				p := path.Join(rel, f.Name)
				if f.IsDir {
					if strings.Count(p, "/") >= 64 {
						return nil, ErrUnavailable
					}
					dirs = append(dirs, p)
				} else {
					files = append(files, File{Path: p, Name: f.Name, Size: f.Size, Modified: f.Modified})
				}
				if len(files)+len(dirs) > 100000 {
					return nil, ErrUnavailable
				}
			}
			if len(seen) >= data.Total {
				break
			}
		}
	}
	return files, nil
}

// DownloadURL resolves a provider URL without downloading any media bytes.
// The URL is a temporary capability: never log or persist it.
func (s *OpenList) DownloadURL(ctx context.Context, relative string) (string, error) {
	p, err := s.absolute(relative)
	if err != nil {
		return "", err
	}
	var data struct {
		RawURL string `json:"raw_url"`
	}
	if err = s.call(ctx, "/api/fs/get", map[string]any{"path": p, "password": ""}, &data); err != nil {
		return "", err
	}
	u, err := url.Parse(data.RawURL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
		return "", ErrUnavailable
	}
	return u.String(), nil
}

// Remove accepts only indexed relative paths under the configured ciphertext root.
func (s *OpenList) Remove(ctx context.Context, relative string) error {
	absolute, err := s.absolute(relative)
	if err != nil {
		return err
	}
	return s.call(ctx, "/api/fs/remove", map[string]any{"dir": path.Dir(absolute), "names": []string{path.Base(absolute)}}, nil)
}
