package main

import (
	"net/http"
	"os"
	"path"
	"strings"
)

// staticHandler serves the built player (web/player/dist).
// Until the player is built it answers 503 with a hint instead of
// failing the whole server — the API stays usable for development.
func staticHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(dir); err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":"player not built yet","hint":"build web/player first"}`))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		// SPA fallback: unknown paths serve index.html so ?m= links survive refresh.
		clean := path.Clean(r.URL.Path)
		if clean != "/" {
			if _, err := os.Stat(dir + clean); err != nil {
				r.URL.Path = "/"
			}
		}
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-store, max-age=0")
		}
		fs.ServeHTTP(w, r)
	})
}
