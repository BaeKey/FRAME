// Package catalog groups media, publishes indexes and coordinates deletions.
package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/BaeKey/FRAME/internal/storage"
)

// Placeholder is the embedded cover used when no image is associated.
const Placeholder = "/static/placeholder.svg"

var localZone = time.FixedZone("Asia/Shanghai", 8*60*60)

// Item describes one indexed file. Paths and pairing internals are not serialized.
type Item struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	User         string `json:"-"`
	Type         string `json:"type"`
	Timestamp    string `json:"timestamp"`
	Size         int64  `json:"size"`
	CoverURL     string `json:"cover_url"`
	StreamURL    string `json:"stream_url"`
	Path         string `json:"-"`
	CoverID      string `json:"cover_file_id"`
	Modified     string `json:"-"`
	PairKey      string `json:"-"`
	Version      string `json:"version"`
	CoverVersion string `json:"cover_version"`
}

// User summarizes a group without exposing storage paths.
type User struct {
	Name         string `json:"name"`
	Count        int    `json:"count"`
	Latest       string `json:"latest"`
	CoverURL     string `json:"cover_url"`
	CoverVersion string `json:"cover_version"`
	CoverFileID  string `json:"cover_file_id"`
}

// Snapshot is an immutable, in-memory view of the durable index.
type Snapshot struct {
	Files        map[string]Item
	Items        []Item
	Users        []User
	Unrecognized int
}

// Build parses filenames and pairs covers deterministically without I/O.
func Build(files []storage.File) *Snapshot {
	rules, _ := compileRules(DefaultRules())
	return buildWithRules(files, rules)
}

func buildWithRules(files []storage.File, rules []compiledRule) *Snapshot {
	files = append([]storage.File(nil), files...)
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	s := &Snapshot{Files: map[string]Item{}, Items: []Item{}, Users: []User{}}
	images := map[string][]string{}
	keys := map[string]string{}
	order := []string{}
	for _, f := range files {
		hash := sha256.Sum256([]byte(f.Path))
		id := hex.EncodeToString(hash[:])
		item := Item{ID: id, Name: f.Name, Path: f.Path, Size: f.Size, Modified: f.Modified, Type: "unknown", User: OtherGroup, CoverURL: Placeholder, StreamURL: "/api/stream/" + id}
		switch strings.ToLower(path.Ext(f.Name)) {
		case ".jpg", ".jpeg", ".png", ".webp", ".gif":
			item.Type = "image"
		case ".mp4":
			item.Type = "video"
		}
		item.User, item.Timestamp = classify(f.Name, rules)
		if item.User != OtherGroup {
			stem := strings.TrimSuffix(f.Name, path.Ext(f.Name))
			if item.Timestamp != "" {
				stem = item.Timestamp
			}
			key := path.Dir(f.Path) + "\x00" + item.User + "\x00" + stem
			item.PairKey = key
			keys[id] = key
			if item.Type == "image" {
				images[key] = append(images[key], id)
			}
		}

		s.Files[id] = item
		order = append(order, id)
	}
	for _, ids := range images {
		if len(ids) > 1 {
			slog.Debug("catalog_multiple_covers", "count", len(ids))
		}
	}
	groups := map[string]*User{}
	coverTimes := map[string]string{}
	for _, id := range order {
		item := s.Files[id]
		key := keys[id]
		if item.Type == "image" {
			item.CoverID = id
		} else if item.Type == "video" && len(images[key]) > 0 {
			item.CoverID = images[key][0]
		}
		if item.CoverID != "" {
			item.CoverURL = "/api/cover/" + id
		}
		s.Files[id] = item
		s.Items = append(s.Items, item)
		if item.User == OtherGroup {
			s.Unrecognized++
		}
		u := groups[item.User]
		if u == nil {
			u = &User{Name: item.User, CoverURL: Placeholder}
			groups[item.User] = u
		}
		u.Count++
		if item.Timestamp > u.Latest || u.Count == 1 {
			u.Latest = item.Timestamp
		}

		// Latest controls ordering, not the cover. A newer unpaired video must
		// not erase an older image. Equal timestamps keep stable path ordering.
		if item.CoverID != "" && (u.CoverURL == Placeholder || item.Timestamp > coverTimes[item.User]) {
			u.CoverURL = item.CoverURL
			coverTimes[item.User] = item.Timestamp
		}
	}
	for _, u := range groups {
		s.Users = append(s.Users, *u)
	}
	sort.Slice(s.Users, func(i, j int) bool {
		if s.Users[i].Latest == s.Users[j].Latest {
			return s.Users[i].Name < s.Users[j].Name
		}
		return s.Users[i].Latest > s.Users[j].Latest
	})
	return s
}

// ForUser returns a sorted copy of the visible items in a group.
func (s *Snapshot) ForUser(name, order string) []Item {
	items := []Item{}
	for _, i := range s.Items {
		if i.User == name {
			items = append(items, i)
		}
	}
	sort.Slice(items, func(a, b int) bool {
		if items[a].Timestamp == items[b].Timestamp {
			return items[a].ID < items[b].ID
		}
		if order == "asc" {
			return items[a].Timestamp < items[b].Timestamp
		}
		return items[a].Timestamp > items[b].Timestamp
	})
	return items
}
