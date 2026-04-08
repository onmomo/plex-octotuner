package channels

import (
	"errors"
	"sync"
	"testing"
)

func TestNewStoreReturnsEmptyChannels(t *testing.T) {
	store := NewStore(testLogger{})
	channels := store.GetChannels()
	if len(channels) != 0 {
		t.Errorf("new store should be empty, got %d channels", len(channels))
	}
}

func TestReplaceFromRawParsesAndStoresChannels(t *testing.T) {
	store := NewStore(testLogger{})
	result := store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1 tvg-chno="5",Channel A
rtsp://10.0.0.1/a
#EXTINF:-1 tvg-chno="10",Channel B
http://10.0.0.1/b`)

	if len(result) != 2 {
		t.Fatalf("expected 2 channels, got %d", len(result))
	}
	if result[0].Name != "Channel A" {
		t.Errorf("first channel name = %q", result[0].Name)
	}
	if result[1].Name != "Channel B" {
		t.Errorf("second channel name = %q", result[1].Name)
	}
}

func TestReplaceFromRawReplacesExistingChannels(t *testing.T) {
	store := NewStore(testLogger{})
	store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1,Old
rtsp://10.0.0.1/old`)

	store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1,New A
rtsp://10.0.0.1/a
#EXTINF:-1,New B
rtsp://10.0.0.1/b`)

	channels := store.GetChannels()
	if len(channels) != 2 {
		t.Fatalf("expected 2 channels after replace, got %d", len(channels))
	}
	if channels[0].Name != "New A" {
		t.Errorf("channel name = %q, want \"New A\"", channels[0].Name)
	}
}

func TestGetChannelsReturnsDefensiveCopy(t *testing.T) {
	store := NewStore(testLogger{})
	store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1,Original
rtsp://10.0.0.1/stream`)

	snapshot := store.GetChannels()
	snapshot[0].Name = "mutated"

	fresh := store.GetChannels()
	if fresh[0].Name == "mutated" {
		t.Error("GetChannels returned a reference to internal slice, not a copy")
	}
}

func TestRefreshUpdatesStore(t *testing.T) {
	store := NewStore(testLogger{})
	fetcher := func() (string, error) {
		return `#EXTM3U
#EXTINF:-1,Refreshed
rtsp://10.0.0.1/stream`, nil
	}

	result, err := store.Refresh(fetcher)
	if err != nil {
		t.Fatalf("Refresh returned error: %v", err)
	}
	if len(result) != 1 || result[0].Name != "Refreshed" {
		t.Fatalf("unexpected result: %v", result)
	}

	channels := store.GetChannels()
	if len(channels) != 1 || channels[0].Name != "Refreshed" {
		t.Fatalf("store not updated: %v", channels)
	}
}

func TestRefreshReturnsErrorOnFetchFailure(t *testing.T) {
	store := NewStore(testLogger{})
	store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1,Existing
rtsp://10.0.0.1/stream`)

	fetcher := func() (string, error) {
		return "", errors.New("network failure")
	}

	_, err := store.Refresh(fetcher)
	if err == nil {
		t.Fatal("expected error from Refresh")
	}

	// Existing channels should be preserved
	channels := store.GetChannels()
	if len(channels) != 1 || channels[0].Name != "Existing" {
		t.Fatalf("store should keep old channels on fetch error, got %v", channels)
	}
}

func TestRefreshReturnsErrorOnZeroChannels(t *testing.T) {
	store := NewStore(testLogger{})
	store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1,Existing
rtsp://10.0.0.1/stream`)

	fetcher := func() (string, error) {
		return "#EXTM3U\n", nil
	}

	_, err := store.Refresh(fetcher)
	if err == nil {
		t.Fatal("expected error for zero-channel playlist")
	}

	// Existing channels should be preserved
	channels := store.GetChannels()
	if len(channels) != 1 {
		t.Fatalf("store should keep old channels on zero-channel refresh, got %d", len(channels))
	}
}

func TestStoreConcurrentAccess(t *testing.T) {
	store := NewStore(testLogger{})
	store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1,Initial
rtsp://10.0.0.1/stream`)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1,Concurrent
rtsp://10.0.0.1/stream`)
		}()
		go func() {
			defer wg.Done()
			_ = store.GetChannels()
		}()
	}
	wg.Wait()

	channels := store.GetChannels()
	if len(channels) == 0 {
		t.Error("store should have channels after concurrent access")
	}
}
