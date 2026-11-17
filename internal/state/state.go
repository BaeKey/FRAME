// Package state keeps short-lived runtime state in memory.
package state

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"

	"github.com/BaeKey/FRAME/internal/storage"
)

// Manager contains only state that is intentionally lost on process restart.
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]session
	pending  map[string][]storage.File
}

type session struct {
	credential string
	expires    time.Time
}

func New() *Manager {
	return &Manager{sessions: make(map[string]session), pending: make(map[string][]storage.File)}
}

// Hash returns a stable opaque identifier without exposing its input.
func Hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func (m *Manager) CreateSession(raw, credential string, expires time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for key, value := range m.sessions {
		if !value.expires.After(now) {
			delete(m.sessions, key)
		}
	}
	m.sessions[Hash(raw)] = session{credential: Hash(credential), expires: expires}
}

func (m *Manager) Session(raw, credential string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	value, ok := m.sessions[Hash(raw)]
	return ok && value.expires.After(time.Now()) && value.credential == Hash(credential)
}

func (m *Manager) Renew(raw string, expires time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := Hash(raw)
	if value, ok := m.sessions[key]; ok {
		value.expires = expires
		m.sessions[key] = value
	}
}

func (m *Manager) Logout(raw string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, Hash(raw))
}

func (m *Manager) Pending(id string, files []storage.File) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pending[id] = append([]storage.File(nil), files...)
}

func (m *Manager) PendingList() map[string][]storage.File {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make(map[string][]storage.File, len(m.pending))
	for id, files := range m.pending {
		out[id] = append([]storage.File(nil), files...)
	}
	return out
}

func (m *Manager) ClearPending(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.pending, id)
}
