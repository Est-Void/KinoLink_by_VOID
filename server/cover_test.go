package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestIsPublicIP(t *testing.T) {
	cases := map[string]bool{
		"127.0.0.1":            false,
		"10.1.2.3":             false,
		"192.168.1.10":         false,
		"172.16.0.1":           false,
		"169.254.1.1":          false,
		"100.64.0.1":           false,
		"0.0.0.0":              false,
		"198.18.0.1":           false,
		"240.0.0.1":            false,
		"::1":                  false,
		"fe80::1":              false,
		"8.8.8.8":              true,
		"1.1.1.1":              true,
		"2606:4700:4700::1111": true,
	}
	for ip, want := range cases {
		if got := isPublicIP(net.ParseIP(ip)); got != want {
			t.Errorf("isPublicIP(%s) = %v, want %v", ip, got, want)
		}
	}
}

func imageUpstream(t *testing.T, contentType, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Errorf("cover proxy sent no User-Agent")
		}
		w.Header().Set("Content-Type", contentType)
		_, _ = w.Write([]byte(body))
	}))
}

func TestCoverProxyServesImage(t *testing.T) {
	up := imageUpstream(t, "image/jpeg", "jpeg-bytes")
	defer up.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/cover?url="+url.QueryEscape("https://image.tmdb.org/t/p/w600/poster.jpg"), nil)
	coverHandler(rec, req, allowlistClient(t, up))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Fatalf("content-type = %q", got)
	}
	if got := rec.Header().Get("Cache-Control"); got == "" {
		t.Fatal("missing Cache-Control")
	}
	if rec.Body.String() != "jpeg-bytes" {
		t.Fatalf("body = %q", rec.Body.String())
	}
}

func TestCoverProxyRejectsNonImage(t *testing.T) {
	up := imageUpstream(t, "text/html", "<html>nope</html>")
	defer up.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/cover?url="+url.QueryEscape("https://image.tmdb.org/page.html"), nil)
	coverHandler(rec, req, allowlistClient(t, up))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestCoverProxyRejectsBadTarget(t *testing.T) {
	for _, raw := range []string{"", "file:///etc/passwd", "not a url", "ftp://example.com/x.jpg"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/cover?url="+url.QueryEscape(raw), nil)
		coverHandler(rec, req, coverHTTPClient)
		if rec.Code != http.StatusNotFound {
			t.Errorf("url %q: status = %d, want 404", raw, rec.Code)
		}
	}
}

// roundTripperFunc adapts a function to http.RoundTripper.
type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

// allowlistClient serves every request from the test upstream, so handler
// tests can exercise the real host allowlist with allowed CDN targets.
func allowlistClient(t *testing.T, up *httptest.Server) *http.Client {
	t.Helper()
	target, err := url.Parse(up.URL)
	if err != nil {
		t.Fatalf("parse upstream url: %v", err)
	}
	return &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		return http.DefaultTransport.RoundTrip(req)
	})}
}

func TestIsAllowedCoverHost(t *testing.T) {
	for _, host := range []string{
		"avatars.mds.yandex.net", "st.kp.yandex.net",
		"image.tmdb.org", "media.themoviedb.org",
		"m.media-amazon.com", "a.ltrbxd.com", "s.ltrbxd.com",
		"IMAGE.TMDB.ORG", // case-insensitive
	} {
		if !isAllowedCoverHost(host) {
			t.Errorf("isAllowedCoverHost(%q) = false, want true", host)
		}
	}
	for _, host := range []string{
		"", "evil.example", "localhost", "127.0.0.1",
		"image.tmdb.org.evil.example", // suffix spoofing
		"sub.image.tmdb.org",          // no subdomains of allowlisted hosts
	} {
		if isAllowedCoverHost(host) {
			t.Errorf("isAllowedCoverHost(%q) = true, want false", host)
		}
	}
}

// The upstream would happily serve the image, so a 200 here would mean the
// allowlist never ran; 404 proves the host check happens before any fetch.
func TestCoverProxyRejectsUnknownHost(t *testing.T) {
	up := imageUpstream(t, "image/jpeg", "x")
	defer up.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/cover?url="+url.QueryEscape("https://evil.example/poster.jpg"), nil)
	coverHandler(rec, req, allowlistClient(t, up))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for non-allowlisted host", rec.Code)
	}
}

func TestCoverClientBlocksPrivateAddresses(t *testing.T) {
	up := imageUpstream(t, "image/jpeg", "x")
	defer up.Close()

	if _, err := newCoverClient().Get(up.URL); err == nil {
		t.Fatal("expected loopback target to be blocked by the cover client")
	}
}
