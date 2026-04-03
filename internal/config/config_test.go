package config

import "testing"

func TestLoadAppliesSafeDefaults(t *testing.T) {
	cfg, err := Load(map[string]string{
		"M3U_URL":             "http://octopus.local/playlist.m3u",
		"ADVERTISED_BASE_URL": "http://192.168.1.50:34400",
	})
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ServerPort != 34400 {
		t.Fatalf("expected server port 34400, got %d", cfg.ServerPort)
	}
	if cfg.FriendlyName != "octotuner" {
		t.Fatalf("expected default friendly name, got %q", cfg.FriendlyName)
	}
	if cfg.DeviceAuth != "octotuner-105A1B22" {
		t.Fatalf("expected default device auth, got %q", cfg.DeviceAuth)
	}
}

func TestLoadRejectsMismatchedPort(t *testing.T) {
	_, err := Load(map[string]string{
		"M3U_URL":             "http://octopus.local/playlist.m3u",
		"ADVERTISED_BASE_URL": "http://192.168.1.50:34400",
		"SERVER_PORT":         "3000",
	})
	if err == nil {
		t.Fatal("expected error for mismatched ports")
	}
}

func TestLoadRejectsInvalidDeviceID(t *testing.T) {
	_, err := Load(map[string]string{
		"M3U_URL":             "http://octopus.local/playlist.m3u",
		"ADVERTISED_BASE_URL": "http://192.168.1.50:34400",
		"HDHR_DEVICE_ID":      "not-valid",
	})
	if err == nil {
		t.Fatal("expected invalid device id error")
	}
}
