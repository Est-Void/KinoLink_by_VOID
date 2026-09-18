package main

import (
	"context"
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
	appVersion   = "2.0.0-dev"
	defaultPort  = 8080
	maxAutoPort  = 8129
	proxyTimeout = 8 * time.Second
)

type config struct {
	port      int
	host      string
	lan       bool
	staticDir string
	kinobox   string
}

func main() {
	if err := run(); err != nil {
		log.Fatalf("kinolink: %v", err)
	}
}

func run() error {
	cfg := config{}
	flag.IntVar(&cfg.port, "port", 0, "use a specific port instead of auto-pick (8080-8129)")
	flag.StringVar(&cfg.host, "host", "", "interface to listen on (default 127.0.0.1)")
	flag.BoolVar(&cfg.lan, "lan", false, "listen on all IPv4 interfaces for LAN devices")
	flag.StringVar(&cfg.staticDir, "static-dir", "web/player/dist", "directory with the built player")
	flag.StringVar(&cfg.kinobox, "kinobox", "https://fbphdplay.top,https://api.kinobox.tv", "comma-separated upstream Kinobox API base URLs (first healthy wins)")
	flag.Parse()

	if cfg.port != 0 && (cfg.port < 1 || cfg.port > 65535) {
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

// bind returns a listener on host:port, or the first free port in
// defaultPort..maxAutoPort when port == 0.
func bind(host string, port int) (net.Listener, int, error) {
	if port != 0 {
		ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, port))
		if err != nil {
			return nil, 0, fmt.Errorf("port %d unavailable: %w", port, err)
		}
		return ln, port, nil
	}
	for p := defaultPort; p <= maxAutoPort; p++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, p))
		if err == nil {
			return ln, p, nil
		}
	}
	return nil, 0, fmt.Errorf("no free port in range %d-%d", defaultPort, maxAutoPort)
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
