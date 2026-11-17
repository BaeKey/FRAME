// Package logging configures structured, level-filtered logs without credentials.
package logging

import (
	"fmt"
	"io"
	"log/slog"
	"strings"
)

func ParseLevel(value string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("logging.level 必须为 debug、info 或 error")
	}
}

// New writes JSON Lines. The caller owns the destination (normally stderr).
func New(w io.Writer, value string) (*slog.Logger, error) {
	level, err := ParseLevel(value)
	if err != nil {
		return nil, err
	}
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level})), nil
}
