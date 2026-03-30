package channels

import (
	"errors"
	"sync"
)

type Store struct {
	channels []Channel
	logger   WarnLogger
	mu       sync.RWMutex
}

func NewStore(logger WarnLogger) *Store {
	return &Store{logger: logger}
}

func (s *Store) ReplaceFromRaw(playlist string) []Channel {
	next := ParseM3U(playlist, s.logger)
	s.mu.Lock()
	s.channels = next
	s.mu.Unlock()
	return s.GetChannels()
}

func (s *Store) Refresh(fetchPlaylist func() (string, error)) ([]Channel, error) {
	playlist, err := fetchPlaylist()
	if err != nil {
		return nil, err
	}
	next := ParseM3U(playlist, s.logger)
	if len(next) == 0 {
		return nil, errors.New("zero valid channels")
	}
	s.mu.Lock()
	s.channels = next
	s.mu.Unlock()
	return s.GetChannels(), nil
}

func (s *Store) GetChannels() []Channel {
	s.mu.RLock()
	defer s.mu.RUnlock()
	next := make([]Channel, len(s.channels))
	copy(next, s.channels)
	return next
}
