package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"plex-octotuner/internal/channels"
	"plex-octotuner/internal/config"
	"plex-octotuner/internal/discovery"
	"plex-octotuner/internal/httpapi"
	"plex-octotuner/internal/logging"
	"syscall"
	"time"
)

func main() {
	logger := logging.New()

	cfg, err := config.Load(readEnv())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	logger.Info("bridge startup config", map[string]any{
		"m3uUrl":                 cfg.M3UURL.String(),
		"advertisedBaseUrl":      cfg.AdvertisedBaseURL.String(),
		"serverPort":             cfg.ServerPort,
		"friendlyName":           cfg.FriendlyName,
		"playlistRefreshSeconds": cfg.PlaylistRefreshSeconds,
		"tunerCount":             cfg.TunerCount,
		"deviceId":               cfg.DeviceID,
	})

	playlist, err := fetchM3U(cfg.M3UURL.String())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	store := channels.NewStore(logger)
	store.ReplaceFromRaw(playlist)
	if len(store.GetChannels()) == 0 {
		fmt.Fprintln(os.Stderr, "zero valid channels")
		os.Exit(1)
	}

	logger.Info(fmt.Sprintf("loaded %d channels", len(store.GetChannels())), nil)

	discoveryHandle, server, _, err := startBridgeServices(
		cfg,
		logger,
		store,
		net.Listen,
		func(server *http.Server, listener net.Listener) {
			go func() {
				logger.Info("Listening on http://0.0.0.0:"+fmt.Sprint(cfg.ServerPort), nil)
				if err := server.Serve(listener); err != nil && err != http.ErrServerClosed && !errors.Is(err, net.ErrClosed) {
					fmt.Fprintln(os.Stderr, err)
					os.Exit(1)
				}
			}()
		},
		func(runtime discovery.Runtime, options discovery.DiscoveryServerOptions) (discovery.Handle, error) {
			return discovery.StartDiscoveryServer(runtime, options)
		},
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	refreshTicker := time.NewTicker(time.Duration(cfg.PlaylistRefreshSeconds) * time.Second)
	stopRefreshLoop := startRefreshLoop(cfg, logger, store, fetchM3U, refreshTicker.C)

	signalCh := make(chan os.Signal, 1)
	signal.Notify(signalCh, syscall.SIGINT, syscall.SIGTERM)
	<-signalCh
	stopRefreshLoop()
	_ = server.Close()
	_ = discoveryHandle.Stop()
}

func readEnv() map[string]string {
	return map[string]string{
		"M3U_URL":                  os.Getenv("M3U_URL"),
		"ADVERTISED_BASE_URL":      os.Getenv("ADVERTISED_BASE_URL"),
		"SERVER_PORT":              os.Getenv("SERVER_PORT"),
		"HDHR_FRIENDLY_NAME":       os.Getenv("HDHR_FRIENDLY_NAME"),
		"PLAYLIST_REFRESH_SECONDS": os.Getenv("PLAYLIST_REFRESH_SECONDS"),
		"HDHR_TUNER_COUNT":         os.Getenv("HDHR_TUNER_COUNT"),
		"HDHR_DEVICE_ID":           os.Getenv("HDHR_DEVICE_ID"),
		"HDHR_DEVICE_AUTH":         os.Getenv("HDHR_DEVICE_AUTH"),
	}
}

func fetchM3U(rawURL string) (string, error) {
	response, err := http.Get(rawURL)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func startDiscovery(
	cfg config.Config,
	logger *logging.Logger,
	_ *channels.Store,
	start func(discovery.Runtime, discovery.DiscoveryServerOptions) (discovery.Handle, error),
) (discovery.Handle, error) {
	return start(discovery.Runtime{
		Config: cfg,
		Logger: logger,
	}, discovery.DiscoveryServerOptions{})
}

func startBridgeServices(
	cfg config.Config,
	logger *logging.Logger,
	store *channels.Store,
	listen func(network, address string) (net.Listener, error),
	serve func(*http.Server, net.Listener),
	start func(discovery.Runtime, discovery.DiscoveryServerOptions) (discovery.Handle, error),
) (discovery.Handle, *http.Server, net.Listener, error) {
	handler := httpapi.NewHandler(&httpapi.Runtime{
		Config: cfg,
		Logger: logger,
		Store:  store,
	})

	server := &http.Server{
		Addr:    fmt.Sprintf("0.0.0.0:%d", cfg.ServerPort),
		Handler: handler,
	}

	listener, err := listen("tcp", server.Addr)
	if err != nil {
		return nil, nil, nil, err
	}

	serve(server, listener)

	discoveryHandle, err := startDiscovery(cfg, logger, store, start)
	if err != nil {
		_ = server.Close()
		_ = listener.Close()
		return nil, nil, nil, err
	}

	return discoveryHandle, server, listener, nil
}

func startRefreshLoop(
	cfg config.Config,
	logger *logging.Logger,
	store *channels.Store,
	fetch func(string) (string, error),
	ticks <-chan time.Time,
) func() {
	stopCh := make(chan struct{})
	doneCh := make(chan struct{})

	go func() {
		defer close(doneCh)

		for {
			select {
			case <-stopCh:
				return
			case <-ticks:
				if _, err := store.Refresh(func() (string, error) {
					return fetch(cfg.M3UURL.String())
				}); err != nil {
					logger.Error("playlist refresh failed", err)
				}
			}
		}
	}()

	return func() {
		close(stopCh)
		<-doneCh
	}
}
