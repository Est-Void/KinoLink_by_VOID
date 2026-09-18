package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const (
	appName      = "kinolink"
	appVersion   = "2.0.2-dev"
	defaultPort  = 8080
	proxyTimeout = 8 * time.Second
)

type config struct {
	port        int
	host        string
	lan         bool
	staticDir   string
	kinobox     string
	healthcheck bool
}

func main() {
	if err := run(); err != nil {
		log.Fatalf("kinolink: %v", err)
	}
}

func run() error {
	cfg := config{}
	flag.IntVar(&cfg.port, "port", defaultPort, "port to listen on (no auto-pick: busy means error)")
	flag.StringVar(&cfg.host, "host", "", "interface to listen on (default 127.0.0.1)")
	flag.BoolVar(&cfg.lan, "lan", false, "listen on all IPv4 interfaces for LAN devices")
	flag.StringVar(&cfg.staticDir, "static-dir", "web/player/dist", "directory with the built player")
	flag.StringVar(&cfg.kinobox, "kinobox", "https://fbphdplay.top,https://api.kinobox.tv", "comma-separated upstream Kinobox API base URLs (first healthy wins)")
	flag.BoolVar(&cfg.healthcheck, "healthcheck", false, "probe /api/status on the local server and exit (used by Docker HEALTHCHECK)")
	flag.Parse()

	if cfg.healthcheck {
		return runHealthcheck(cfg.port)
	}

	// Port 0 is not "auto-pick" anymore: bind() listens on exactly this port,
	// so 0 would silently land on an ephemeral port and report "port 0".
	if cfg.port < 1 || cfg.port > 65535 {
		return errors.New("port must be in range 1-65535")
	}
	if cfg.lan && cfg.host != "" {
		return errors.New("--lan cannot be used together with --host")
	}

	host := cfg.host
	if host == "" {
		if cfg.lan {
			host = "0.0.0.0"
		} else {
			host = "127.0.0.1"
		}
	}

	ln, port, err := bind(host, cfg.port)
	if err != nil {
		return err
	}

	srv := &http.Server{
		Handler:      routes(cfg, host, port),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	printBanner(host, port, cfg)
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// runHealthcheck performs a real HTTP probe for container health checks
// (distroless images ship no curl/wget). Exit code is driven by the caller.
func runHealthcheck(port int) error {
	if port == 0 {
		port = defaultPort
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/status", port))
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	defer resp.Body.Close()

	var status statusResponse
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return fmt.Errorf("healthcheck: decode: %w", err)
	}
	if resp.StatusCode != http.StatusOK || status.Status != "ok" {
		return fmt.Errorf("healthcheck: status %d", resp.StatusCode)
	}
	return nil
}

// bind listens on exactly host:port. No port scanning: the product targets
// non-technical users, so the address must always be the same.
func bind(host string, port int) (net.Listener, int, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, port))
	if err != nil {
		return nil, 0, fmt.Errorf("port %d is busy, free it and try again: %w", port, err)
	}
	return ln, port, nil
}

func printBanner(host string, port int, cfg config) {
	if host == "0.0.0.0" || host == "::" {
		log.Printf("KinoLink server on http://%s:%d (local: http://127.0.0.1:%d)", host, port, port)
		for _, addr := range lanAddresses() {
			log.Printf("LAN: http://%s:%d", addr, port)
		}
		log.Print("WARNING: reachable by all LAN devices. Do not use --lan on public networks.")
		return
	}
	log.Printf("KinoLink server on http://%s:%d (static: %s)", host, port, cfg.staticDir)
}

// lanAddresses returns private IPv4 addresses usable from the LAN.
func lanAddresses() []string {
	seen := map[string]bool{}
	var out []string
	add := func(ip net.IP) {
		if ip == nil || ip.IsLoopback() || !ip.IsPrivate() {
			return
		}
		if v := ip.To4(); v != nil {
			if s := v.String(); !seen[s] {
				seen[s] = true
				out = append(out, s)
			}
		}
	}

	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok {
				add(ipnet.IP)
			}
		}
	}
	// Address picked by the default route (no traffic is sent).
	if conn, err := net.Dial("udp", "192.0.2.1:80"); err == nil {
		if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
			add(addr.IP)
		}
		_ = conn.Close()
	}
	return out
}
