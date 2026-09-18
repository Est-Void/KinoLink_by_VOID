package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testRoutes(kinobox, staticDir string) http.Handler {
	return routes(config{kinobox: kinobox, staticDir: staticDir}, "127.0.0.1", 8080)
}

func TestStatus(t *testing.T) {
	rec := httptest.NewRecorder()
	testRoutes("", t.TempDir()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/status", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if got.App != appName || got.Status != "ok" || got.Port != 8080 || got.Host != "127.0.0.1" {
		t.Fatalf("unexpected status body: %+v", got)
	}
}

func TestPlayersMissingID(t *testing.T) {
	rec := httptest.NewRecorder()
	testRoutes("", t.TempDir()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/players", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func mockUpstream(t *testing.T, code int, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/players") {
			t.Errorf("unexpected upstream path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write([]byte(body))
	}))
}

func TestPlayersProxyFiltersAndTurboLast(t *testing.T) {
	up := mockUpstream(t, 200, `{"data":[
		{"type":"Turbo","iframeUrl":"https://example.com/t"},
		{"type":"","iframeUrl":"https://example.com/empty"},
		{"type":"Bad","iframeUrl":"javascript:alert(1)"},
		{"type":"Relative","iframeUrl":"/no-host"},
		{"type":"Alloha","iframeUrl":"https://example.com/a"}
	]}`)
	defer up.Close()

	rec := httptest.NewRecorder()
	h := testRoutes(up.URL, t.TempDir())
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/players?kinopoisk=535341", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got playersResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode players: %v", err)
	}
	if len(got.Data) != 2 {
		t.Fatalf("got %d sources, want 2 (Alloha, Turbo): %+v", len(got.Data), got.Data)
	}
	if got.Data[0].Type != "Alloha" || got.Data[1].Type != "Turbo" {
		t.Fatalf("turbo must be last, got %+v", got.Data)
	}
}

func TestPlayersFallbackToSecondUpstream(t *testing.T) {
	dead := mockUpstream(t, 500, `oops`)
	defer dead.Close()
	alive := mockUpstream(t, 200, `{"data":[{"type":"Alloha","iframeUrl":"https://example.com/a"}]}`)
	defer alive.Close()

	rec := httptest.NewRecorder()
	h := testRoutes(dead.URL+","+alive.URL, t.TempDir())
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/players?imdb=tt0111161", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 via fallback", rec.Code)
	}
	var got playersResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || len(got.Data) != 1 {
		t.Fatalf("want 1 source via fallback, got %+v (err=%v)", got, err)
	}
}

func TestPlayersAllUpstreamsDown(t *testing.T) {
	dead := mockUpstream(t, 500, `oops`)
	defer dead.Close()

	rec := httptest.NewRecorder()
	h := testRoutes(dead.URL, t.TempDir())
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/players?tmdb=123", nil))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
}

func TestPickIDPrefersKinopoisk(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/players?tmdb=1&imdb=tt1&kinopoisk=2", nil)
	id, kind := pickID(req.URL.Query())
	if id != "2" || kind != "kinopoisk" {
		t.Fatalf("got %s=%s, want kinopoisk=2", kind, id)
	}
}
