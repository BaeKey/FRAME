package web

import (
	"embed"
	"io/fs"
)

//go:embed dist
var dist embed.FS

// Assets exposes only the Vite production output to the HTTP server.
var Assets, _ = fs.Sub(dist, "dist")
