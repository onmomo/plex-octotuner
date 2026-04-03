package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"plex-octotuner/internal/channels"
	"plex-octotuner/internal/config"
	"plex-octotuner/internal/hdhr"
	"plex-octotuner/internal/rtsp"
	"strings"
)

type Logger interface {
	Info(message string, context any)
	Error(message string, context any)
	Warn(message string, context any)
}

type Runtime struct {
	Config config.Config
	Logger Logger
	Store  *channels.Store
}

func NewHandler(runtime *Runtime) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/discover.json", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, hdhr.BuildDiscoverJSON(
			runtime.Config.FriendlyName,
			runtime.Config.DeviceID,
			runtime.Config.DeviceAuth,
			runtime.Config.AdvertisedBaseURL,
			runtime.Config.TunerCount,
		))
	})

	mux.HandleFunc("/device.xml", func(w http.ResponseWriter, r *http.Request) {
		writeDeviceXML(w, runtime)
	})
	mux.HandleFunc("/dri/device.xml", func(w http.ResponseWriter, r *http.Request) {
		writeDeviceXML(w, runtime)
	})

	mux.HandleFunc("/lineup.json", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, hdhr.BuildLineup(runtime.Store.GetChannels(), runtime.Config.AdvertisedBaseURL))
	})

	mux.HandleFunc("/lineup_status.json", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, hdhr.BuildLineupStatus())
	})

	mux.HandleFunc("/lineup.post", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(""))
	})

	mux.HandleFunc("/auto/", func(w http.ResponseWriter, r *http.Request) {
		if err := handlePlayback(w, r, runtime); err != nil {
			statusCode := http.StatusInternalServerError
			if errors.Is(err, errChannelNotFound) {
				statusCode = http.StatusNotFound
			}
			http.Error(w, err.Error(), statusCode)
		}
	})

	return mux
}

var errChannelNotFound = errors.New("channel not found")

func handlePlayback(w http.ResponseWriter, r *http.Request, runtime *Runtime) error {
	slug := r.URL.Path[len("/auto/"):]
	if len(slug) < 2 || slug[0] != 'v' {
		return errChannelNotFound
	}
	channelID := slug[1:]
	var channel *channels.Channel
	for _, entry := range runtime.Store.GetChannels() {
		if entry.ID == channelID {
			entryCopy := entry
			channel = &entryCopy
			break
		}
	}
	if channel == nil {
		return errChannelNotFound
	}

	runtime.Logger.Info("channel playback started", map[string]any{
		"channelId":   channel.ID,
		"channelName": channel.Name,
		"upstreamUrl": channel.StreamURL,
	})

	if streamURL := channel.StreamURL; strings.HasPrefix(streamURL, "rtsp://") || strings.HasPrefix(streamURL, "rtsps://") {
		if err := rtsp.Relay(r.Context(), w, streamURL, runtime.Logger); err != nil {
			return err
		}
		return nil
	}

	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, channel.StreamURL, http.StatusFound)
	return nil
}

func writeDeviceXML(w http.ResponseWriter, runtime *Runtime) {
	payload, err := hdhr.BuildDeviceXML(
		runtime.Config.FriendlyName,
		runtime.Config.DeviceID,
		runtime.Config.AdvertisedBaseURL,
		hdhr.BuildDeviceUdn(runtime.Config.DeviceID),
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	_, _ = w.Write([]byte(payload))
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	encoder := json.NewEncoder(w)
	_ = encoder.Encode(payload)
}
