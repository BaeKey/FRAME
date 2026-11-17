package state

import (
	"testing"
	"time"

	"github.com/BaeKey/FRAME/internal/storage"
)

func TestSessionLifecycle(t *testing.T) {
	manager := New()
	expires := time.Now().Add(time.Minute)
	manager.CreateSession("cookie", "access-token", expires)
	if !manager.Session("cookie", "access-token") {
		t.Fatal("new session should be valid")
	}
	if manager.Session("cookie", "different-token") {
		t.Fatal("session should be bound to its credential")
	}
	manager.Renew("cookie", time.Now().Add(2*time.Minute))
	manager.Logout("cookie")
	if manager.Session("cookie", "access-token") {
		t.Fatal("logged-out session should be invalid")
	}
}

func TestPendingTasksAreCopiedAndCleared(t *testing.T) {
	manager := New()
	files := []storage.File{{Path: "group/video.mp4", Name: "video.mp4", Size: 10}}
	manager.Pending("task", files)
	files[0].Name = "changed.mp4"
	loaded := manager.PendingList()
	if loaded["task"][0].Name != "video.mp4" {
		t.Fatal("pending task should not retain caller-owned slices")
	}
	loaded["task"][0].Name = "also-changed.mp4"
	if manager.PendingList()["task"][0].Name != "video.mp4" {
		t.Fatal("pending task reads should return copies")
	}
	manager.ClearPending("task")
	if _, ok := manager.PendingList()["task"]; ok {
		t.Fatal("cleared task should be absent")
	}
}
