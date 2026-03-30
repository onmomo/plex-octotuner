package discovery

import (
	"net/url"
	"testing"
)

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	return parsed
}

func mustParseHexDeviceID(t *testing.T, raw string) uint32 {
	t.Helper()
	value, err := parseHexDeviceID(raw)
	if err != nil {
		t.Fatalf("parse hex device id: %v", err)
	}
	return value
}
