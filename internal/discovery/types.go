package discovery

import (
	"errors"
	"sync"

	"plex-octotuner/internal/config"
)

type Logger interface {
	Info(message string, context any)
	Error(message string, context any)
	Warn(message string, context any)
}

type Runtime struct {
	Config config.Config
	Logger Logger
}

type Handle interface {
	Stop() error
}

type stopHandle struct {
	once sync.Once
	stop func() error
	err  error
}

func (h *stopHandle) Stop() error {
	if h == nil {
		return nil
	}

	h.once.Do(func() {
		if h.stop != nil {
			h.err = h.stop()
		}
	})

	return h.err
}

func newStopHandle(stop func() error) Handle {
	return &stopHandle{stop: stop}
}

var errDiscoveryServerClosed = errors.New("discovery server closed")
