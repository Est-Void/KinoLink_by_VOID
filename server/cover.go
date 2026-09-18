package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	coverMaxBytes = 8 << 20 // 8 MiB, same cap as v1
	coverTimeout  = 12 * time.Second
	// A browser UA helps with CDNs that reject non-browser clients.
	coverUserAgent = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
)

// coverHTTPClient fetches posters for /api/cover. Its dialer refuses to connect
// to non-public addresses, which blocks SSRF — including via redirects and DNS
// rebinding — at connect time rather than at URL-parse time.
var coverHTTPClient = newCoverClient()

func newCoverClient() *http.Client {
	dialer := &net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip == nil || !isPublicIP(ip) {
				return fmt.Errorf("blocked non-public address %s", host)
			}
			return nil
		},
	}
	return &http.Client{
		Timeout: coverTimeout,
		Transport: &http.Transport{
			DialContext:           dialer.DialContext,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 8 * time.Second,
			MaxIdleConns:          16,
			IdleConnTimeout:       60 * time.Second,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if !isHTTPURL(req.URL) {
				return errors.New("unsafe redirect")
			}
			return nil
		},
	}
}

func isHTTPURL(u *url.URL) bool {
	return u != nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != ""
}

// isPublicIP reports whether ip is routable on the public internet. Everything
// private, loopback, link-local, multicast or reserved is rejected so the proxy
// cannot be pointed at the local network.
func isPublicIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		switch {
		case v4[0] == 0: // 0.0.0.0/8
			return false
		case v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127: // 100.64.0.0/10 CGNAT
			return false
		case v4[0] == 192 && v4[1] == 0 && v4[2] == 0: // 192.0.0.0/24
			return false
		case v4[0] == 198 && (v4[1] == 18 || v4[1] == 19): // 198.18.0.0/15
			return false
		case v4[0] >= 240: // 240.0.0.0/4 + broadcast
			return false
		}
	}
	return true
}

// coverHandler proxies a remote poster through the server so the browser never
// hotlinks the source CDN (referer/hotlink blocks) and the player stays
// same-origin. It answers 404 on anything that is not a small raster image.
func coverHandler(w http.ResponseWriter, r *http.Request, client *http.Client) {
	if r.Method != http.MethodGet {
		writeErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	target, err := url.Parse(strings.TrimSpace(r.URL.Query().Get("url")))
	if err != nil || !isHTTPURL(target) {
		http.NotFound(w, r)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), coverTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	req.Header.Set("User-Agent", coverUserAgent)
	req.Header.Set("Accept", "image/*,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.NotFound(w, r)
		return
	}

	mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	// image/svg+xml is rejected too: served same-origin it could execute script
	// as a top-level document (stored XSS via ?url=).
	if err != nil || !strings.HasPrefix(mediaType, "image/") || mediaType == "image/svg+xml" {
		http.NotFound(w, r)
		return
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, coverMaxBytes+1))
	if err != nil || len(body) == 0 || len(body) > coverMaxBytes {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", mediaType)
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
