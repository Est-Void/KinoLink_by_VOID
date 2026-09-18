package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestResolveImdbFromTmdb(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/sparql-results+json")
		imdb := "tt1160419"
		if strings.Contains(r.URL.Query().Get("query"), "P4983") {
			imdb = "tt9813792"
		}
		fmt.Fprintf(w, `{"results":{"bindings":[{"imdb":{"value":%q}}]}}`, imdb)
	}))
	defer up.Close()

	client := &http.Client{Timeout: 5 * time.Second}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	got, err := resolveImdbFromTmdb(ctx, client, up.URL, "438631", false)
	if err != nil || got != "tt1160419" {
		t.Fatalf("got %q, err %v", got, err)
	}

	got, err = resolveImdbFromTmdb(ctx, client, up.URL, "124364", true)
	if err != nil || got != "tt9813792" {
		t.Fatalf("series-first: got %q, err %v", got, err)
	}
}

func TestResolveImdbFromTmdbEmpty(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"results":{"bindings":[]}}`))
	}))
	defer up.Close()

	client := &http.Client{Timeout: 5 * time.Second}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := resolveImdbFromTmdb(ctx, client, up.URL, "1", false); err == nil {
		t.Fatal("expected error for empty bindings")
	}
}

func TestPickIDValidation(t *testing.T) {
	cases := []struct {
		query    string
		wantID   string
		wantKind string
	}{
		{"kinopoisk=535341", "535341", "kinopoisk"},
		{"kinopoisk=12ab", "", ""},
		{"imdb=tt0111161", "tt0111161", "imdb"},
		{"imdb=tt", "", ""},
		{"imdb=123", "", ""},
		{"tmdb=438631", "438631", "tmdb"},
		{"tmdb=abc", "", ""},
		{"kinopoisk=1&imdb=tt2&tmdb=3", "1", "kinopoisk"},
		{"foo=bar", "", ""},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, "/api/players?"+c.query, nil)
		id, kind := pickID(req.URL.Query())
		if id != c.wantID || kind != c.wantKind {
			t.Errorf("query %q: got %s=%s, want %s=%s", c.query, kind, id, c.wantKind, c.wantID)
		}
	}
}
