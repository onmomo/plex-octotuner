package main

import (
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"plex-octotuner/internal/channels"
	"plex-octotuner/internal/config"
	"plex-octotuner/internal/discovery"
	"plex-octotuner/internal/logging"
)

type discoveryStartCall struct {
	runtime discovery.Runtime
	options discovery.DiscoveryServerOptions
}

func TestStartDiscoveryUsesBridgeRuntime(t *testing.T) {
	cfg, err := config.Load(map[string]string{
		"M3U_URL":             "http://octopus.local/playlist.m3u",
		"ADVERTISED_BASE_URL": "http://192.168.1.50:34400",
	})
	if err != nil {
		t.Fatalf("config load: %v", err)
	}

	logger := logging.New()
	store := channels.NewStore(logger)
	store.ReplaceFromRaw("#EXTM3U\n#EXTINF:-1,Channel One\nhttp://example.com/stream/1\n")

	var captured discoveryStartCall
	handle, err := startDiscovery(cfg, logger, store, func(runtime discovery.Runtime, options discovery.DiscoveryServerOptions) (discovery.Handle, error) {
		captured = discoveryStartCall{runtime: runtime, options: options}
		return discoveryHandleStub{}, nil
	})
	if err != nil {
		t.Fatalf("startDiscovery() error = %v", err)
	}
	if handle == nil {
		t.Fatal("expected a discovery handle")
	}
	if captured.runtime.Config.DeviceID != cfg.DeviceID {
		t.Fatalf("device id = %q, want %q", captured.runtime.Config.DeviceID, cfg.DeviceID)
	}
	if captured.runtime.Logger != logger {
		t.Fatal("expected discovery runtime to reuse the startup logger")
	}
	if captured.options.BindAddress != "" {
		t.Fatalf("bind address = %q, want empty default", captured.options.BindAddress)
	}
}

func TestStartDiscoveryReturnsStartupError(t *testing.T) {
	cfg, err := config.Load(map[string]string{
		"M3U_URL":             "http://octopus.local/playlist.m3u",
		"ADVERTISED_BASE_URL": "http://192.168.1.50:34400",
	})
	if err != nil {
		t.Fatalf("config load: %v", err)
	}

	logger := logging.New()
	store := channels.NewStore(logger)
	expectedErr := errors.New("boom")

	_, err = startDiscovery(cfg, logger, store, func(runtime discovery.Runtime, options discovery.DiscoveryServerOptions) (discovery.Handle, error) {
		return nil, expectedErr
	})
	if !errors.Is(err, expectedErr) {
		t.Fatalf("error = %v, want %v", err, expectedErr)
	}
}

func TestStartBridgeServicesBindsHTTPBeforeDiscovery(t *testing.T) {
	cfg, err := config.Load(map[string]string{
		"M3U_URL":             "http://octopus.local/playlist.m3u",
		"ADVERTISED_BASE_URL": "http://192.168.1.50:34400",
	})
	if err != nil {
		t.Fatalf("config load: %v", err)
	}

	logger := logging.New()
	store := channels.NewStore(logger)
	store.ReplaceFromRaw("#EXTM3U\n#EXTINF:-1,Channel One\nhttp://example.com/stream/1\n")

	listener := newStubListener()
	httpBound := false
	httpServeStarted := false
	discoverySawReadyHTTP := false

	handle, server, boundListener, err := startBridgeServices(
		cfg,
		logger,
		store,
		func(network, address string) (net.Listener, error) {
			httpBound = true
			return listener, nil
		},
		func(server *http.Server, listener net.Listener) {
			if !httpBound {
				t.Fatal("serve started before HTTP bind")
			}
			httpServeStarted = true
		},
		func(runtime discovery.Runtime, options discovery.DiscoveryServerOptions) (discovery.Handle, error) {
			discoverySawReadyHTTP = httpBound && httpServeStarted
			return discoveryHandleStub{}, nil
		},
	)
	if err != nil {
		t.Fatalf("startBridgeServices() error = %v", err)
	}
	if !discoverySawReadyHTTP {
		t.Fatal("expected discovery startup to happen after HTTP bind and serve start")
	}
	if handle == nil {
		t.Fatal("expected discovery handle")
	}
	if server == nil {
		t.Fatal("expected http server")
	}
	if boundListener != listener {
		t.Fatal("expected returned listener to match the bound listener")
	}

	_ = handle.Stop()
	_ = boundListener.Close()
}

func TestStartBridgeServicesClosesBoundListenerWhenDiscoveryStartupFails(t *testing.T) {
	cfg, err := config.Load(map[string]string{
		"M3U_URL":             "http://octopus.local/playlist.m3u",
		"ADVERTISED_BASE_URL": "http://192.168.1.50:34400",
	})
	if err != nil {
		t.Fatalf("config load: %v", err)
	}

	logger := logging.New()
	store := channels.NewStore(logger)
	listener := newStubListener()
	expectedErr := errors.New("discovery failed")

	_, _, _, err = startBridgeServices(
		cfg,
		logger,
		store,
		func(network, address string) (net.Listener, error) {
			return listener, nil
		},
		func(server *http.Server, listener net.Listener) {},
		func(runtime discovery.Runtime, options discovery.DiscoveryServerOptions) (discovery.Handle, error) {
			return nil, expectedErr
		},
	)
	if !errors.Is(err, expectedErr) {
		t.Fatalf("error = %v, want %v", err, expectedErr)
	}
	if !listener.isClosed() {
		t.Fatal("expected listener to be closed on discovery startup failure")
	}
}

func TestStartRefreshLoopRefreshesStoreAndKeepsLastGoodLineupOnFailure(t *testing.T) {
	cfg, err := config.Load(map[string]string{
		"M3U_URL":                  "http://octopus.local/playlist.m3u",
		"ADVERTISED_BASE_URL":      "http://192.168.1.50:34400",
		"PLAYLIST_REFRESH_SECONDS": "1",
	})
	if err != nil {
		t.Fatalf("config load: %v", err)
	}

	logger := logging.New()
	store := channels.NewStore(logger)
	store.ReplaceFromRaw("#EXTM3U\n#EXTINF:-1,Initial\nhttp://example.com/initial\n")

	refreshCalls := 0
	ticks := make(chan time.Time, 2)
	stop := startRefreshLoop(
		cfg,
		logger,
		store,
		func(rawURL string) (string, error) {
			refreshCalls++
			switch refreshCalls {
			case 1:
				return "#EXTM3U\n#EXTINF:-1,Updated\nhttp://example.com/updated\n", nil
			default:
				return "#EXTM3U\n#EXTINF:-1,Broken\n", nil
			}
		},
		ticks,
	)
	defer stop()

	ticks <- time.Now()
	waitForCondition(t, func() bool {
		return len(store.GetChannels()) == 1 && store.GetChannels()[0].Name == "Updated"
	})

	ticks <- time.Now()
	waitForCondition(t, func() bool {
		return strings.Contains(strings.Join(logger.Sink, "\n"), "playlist refresh failed")
	})

	channels := store.GetChannels()
	if len(channels) != 1 || channels[0].Name != "Updated" {
		t.Fatalf("expected last good lineup to be retained, got %#v", channels)
	}
}

type discoveryHandleStub struct{}

func (discoveryHandleStub) Stop() error { return nil }

type stubListener struct {
	closed chan struct{}
}

func newStubListener() *stubListener {
	return &stubListener{closed: make(chan struct{})}
}

func (l *stubListener) Accept() (net.Conn, error) {
	<-l.closed
	return nil, net.ErrClosed
}

func (l *stubListener) Close() error {
	select {
	case <-l.closed:
	default:
		close(l.closed)
	}
	return nil
}

func (l *stubListener) Addr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4zero, Port: 34400}
}

func (l *stubListener) isClosed() bool {
	select {
	case <-l.closed:
		return true
	default:
		return false
	}
}

var _ net.Listener = (*stubListener)(nil)
var _ http.Handler = http.NewServeMux()

func waitForCondition(t *testing.T, condition func() bool) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatal("condition was not met before timeout")
}
