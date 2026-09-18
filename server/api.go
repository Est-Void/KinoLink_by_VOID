package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
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

func routes(cfg config, port int) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		host, _, _ := net.SplitHostPort(r.Context().Value(http.LocalAddrContextKey).(net.Addr).String())
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
	mux.Handle("/", staticHandler(cfg.staticDir))
	return mux
}

// playersHandler proxies the upstream Kinobox API so the browser never
// touches it directly (no CORS issues, single timeout/UA policy).
func playersHandler(w http.ResponseWriter, r *http.Request, cfg config) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	id, kind := pickID(q)
	if id == "" {
		http.Error(w, `{"error":"one of kinopoisk, imdb, tmdb query params is required"}`, http.StatusBadRequest)
		return
	}

	upstreams := strings.Split(cfg.kinobox, ",")
	client := &http.Client{Timeout: proxyTimeout}
	var sources []playerSource
	var err error
	for _, base := range upstreams {
		base = strings.TrimSpace(strings.TrimSuffix(base, "/"))
		if base == "" {
			continue
		}
		sources, err = fetchUpstream(r.Context(), client, base+"/api/players", kind, id)
		if err != nil {
			log.Printf("kinolink: upstream %s failed: %v", base, err)
			continue
		}
		if len(sources) > 0 {
			break
		}
	}
	if err != nil && len(sources) == 0 {
		http.Error(w, `{"error":"upstream unavailable"}`, http.StatusBadGateway)
		return
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
	for i, s := range sources {
		if strings.EqualFold(s.Type, "turbo") {
			sources = append(sources[:i], sources[i+1:]...)
			sources = append(sources, s)
			break
		}
	}

	return sources, nil
}

// pickID returns the first usable external ID, preferring kinopoisk.
func pickID(q url.Values) (id, kind string) {
	for _, k := range []string{"kinopoisk", "imdb", "tmdb"} {
		if v := strings.TrimSpace(q.Get(k)); v != "" && len(v) <= 32 {
			return v, k
		}
	}
	return "", ""
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
