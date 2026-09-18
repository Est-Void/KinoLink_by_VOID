package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
)

type statusResponse struct {
	App     string `json:"app"`
	Version string `json:"version"`
	Status  string `json:"status"`
	Host    string `json:"host"`
	Port    int    `json:"port"`
	PID     int    `json:"pid"`
}

type playerSource struct {
	Type      string `json:"type"`
	IframeURL string `json:"iframeUrl"`
}

type playersResponse struct {
	Data []playerSource `json:"data"`
}

// CORS is kept in sync with the userscript @match patterns (see
// web/userscript/vite.config.ts): exact Kinopoisk/TMDB/Letterboxd hosts plus
// any IMDb subdomain. Chrome additionally gates public→localhost requests
// behind Private Network Access — hence Access-Control-Allow-Private-Network.
var allowedCORSOrigins = map[string]bool{
	"https://www.kinopoisk.ru":   true,
	"https://hd.kinopoisk.ru":    true,
	"https://www.themoviedb.org": true,
	"https://letterboxd.com":     true,
}

// allowedCORSSubdomains covers @match entries of the form *://*.domain/…
var allowedCORSSubdomains = []string{"imdb.com"}

func isAllowedCORSOrigin(origin string) bool {
	if allowedCORSOrigins[origin] {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" {
		return false
	}
	host := u.Hostname()
	for _, domain := range allowedCORSSubdomains {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

func routes(cfg config, host string, port int) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		writeJSON(w, http.StatusOK, statusResponse{
			App:     appName,
			Version: appVersion,
			Status:  "ok",
			Host:    host,
			Port:    port,
			PID:     os.Getpid(),
		})
	})
	mux.HandleFunc("/api/players", func(w http.ResponseWriter, r *http.Request) {
		playersHandler(w, r, cfg)
	})
	mux.HandleFunc("/api/cover", func(w http.ResponseWriter, r *http.Request) {
		coverHandler(w, r, coverHTTPClient)
	})
	// Any other /api/ path must stay a JSON 404 and never fall through to the
	// SPA handler (which would answer 503 while the player is unbuilt).
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeErrorJSON(w, http.StatusNotFound, "not found")
	})
	mux.Handle("/", staticHandler(cfg.staticDir))
	return withCORS(mux)
}

// withCORS answers preflights and adds CORS headers for allowed Kinopoisk
// origins. Other origins get no CORS headers, so the browser blocks them.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); isAllowedCORSOrigin(origin) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Add("Vary", "Origin")
			h.Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Allow-Private-Network", "true")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// playersHandler proxies the upstream Kinobox API so the browser never
// touches it directly (no CORS issues, single timeout/UA policy).
func playersHandler(w http.ResponseWriter, r *http.Request, cfg config) {
	if r.Method != http.MethodGet {
		writeErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	id, kind := pickID(q)
	if id == "" {
		writeErrorJSON(w, http.StatusBadRequest, "one of kinopoisk, imdb, tmdb query params is required")
		return
	}

	// The Kinobox mirrors only understand kinopoisk/imdb. Resolve TMDB ids
	// to IMDb via Wikidata so TMDB-sourced opens keep working.
	client := &http.Client{Timeout: proxyTimeout}
	if kind == "tmdb" {
		seriesFirst := strings.TrimSpace(q.Get("type")) == "series"
		if imdb, err := resolveImdbFromTmdb(r.Context(), client, wikidataSparqlEndpoint, id, seriesFirst); err == nil {
			log.Printf("kinolink: resolved tmdb %s -> %s", id, imdb)
			id, kind = imdb, "imdb"
		} else {
			log.Printf("kinolink: tmdb resolve failed for %s: %v", id, err)
		}
	}

	var (
		sources   []playerSource
		tried     int
		succeeded bool
		lastErr   error
	)
	for _, base := range strings.Split(cfg.kinobox, ",") {
		base = strings.TrimSpace(strings.TrimSuffix(base, "/"))
		if base == "" {
			continue
		}
		tried++
		got, err := fetchUpstream(r.Context(), client, base+"/api/players", kind, id)
		if err != nil {
			lastErr = err
			log.Printf("kinolink: upstream %s failed: %v", base, err)
			continue
		}
		// A healthy-but-empty response is still a success: stop only when we
		// actually have sources to show, otherwise try the next mirror.
		succeeded = true
		lastErr = nil
		sources = got
		if len(got) > 0 {
			break
		}
	}

	// An empty successful answer is valid, but if nothing ever succeeded we
	// must not pretend the API worked.
	if !succeeded {
		if tried == 0 {
			writeErrorJSON(w, http.StatusBadGateway, "no upstream configured")
			return
		}
		log.Printf("kinolink: all upstreams failed, last error: %v", lastErr)
		writeErrorJSON(w, http.StatusBadGateway, "upstream unavailable")
		return
	}
	if sources == nil {
		sources = []playerSource{}
	}

	writeJSON(w, http.StatusOK, playersResponse{Data: sources})
}

func fetchUpstream(ctx context.Context, client *http.Client, endpoint, kind, id string) ([]playerSource, error) {
	upstream, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	uq := upstream.Query()
	uq.Set(kind, id)
	upstream.RawQuery = uq.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstream.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "kinolink/2.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	var upstreamResp playersResponse
	if err := json.Unmarshal(body, &upstreamResp); err != nil || upstreamResp.Data == nil {
		return nil, fmt.Errorf("bad response")
	}

	sources := make([]playerSource, 0, len(upstreamResp.Data))
	for _, s := range upstreamResp.Data {
		if s.Type == "" || !isSafeHTTPURL(s.IframeURL) {
			continue
		}
		sources = append(sources, playerSource{Type: s.Type, IframeURL: s.IframeURL})
	}
	// Turbo rarely works — keep it available but last.
	ordered := make([]playerSource, 0, len(sources))
	var turbo []playerSource
	for _, s := range sources {
		if strings.EqualFold(s.Type, "turbo") {
			turbo = append(turbo, s)
			continue
		}
		ordered = append(ordered, s)
	}
	return append(ordered, turbo...), nil
}

// pickID returns the first usable external ID, preferring kinopoisk.
// Shapes are validated so they are safe to forward upstream or embed in SPARQL.
func pickID(q url.Values) (id, kind string) {
	if v := strings.TrimSpace(q.Get("kinopoisk")); validDigits(v) {
		return v, "kinopoisk"
	}
	if v := strings.TrimSpace(q.Get("imdb")); validImdb(v) {
		return v, "imdb"
	}
	if v := strings.TrimSpace(q.Get("tmdb")); validDigits(v) {
		return v, "tmdb"
	}
	return "", ""
}

func validDigits(v string) bool {
	if v == "" || len(v) > 20 {
		return false
	}
	for _, c := range v {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func validImdb(v string) bool {
	if len(v) < 3 || len(v) > 22 || !strings.HasPrefix(v, "tt") {
		return false
	}
	return validDigits(v[2:])
}

func isSafeHTTPURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return false
	}
	return u.Scheme == "http" || u.Scheme == "https"
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, max-age=0")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// writeErrorJSON keeps error replies valid JSON with the right content type
// (http.Error would label the JSON body as text/plain).
func writeErrorJSON(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
