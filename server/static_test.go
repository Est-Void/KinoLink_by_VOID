package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestStaticMissingDirHint(t *testing.T) {
	rec := httptest.NewRecorder()
	staticHandler(filepath.Join(t.TempDir(), "nope")).ServeHTTP(
		rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestStaticServesFilesAndSPAFallback(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>player</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := staticHandler(dir)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/app.js", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("asset status = %d, want 200", rec.Code)
	}

	// Unknown deep link falls back to index.html so ?m= links survive refresh.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/watch/123", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "<h1>player</h1>" {
		t.Fatalf("spa fallback broken: %d %q", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("api passthrough status = %d, want 404", rec.Code)
	}
}
