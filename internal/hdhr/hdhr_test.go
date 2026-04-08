package hdhr

import (
	"encoding/xml"
	"net/url"
	"plex-octotuner/internal/channels"
	"strings"
	"testing"
)

// ---- BuildDeviceXML --------------------------------------------------------

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("url.Parse(%q): %v", raw, err)
	}
	return u
}

func TestBuildDeviceXMLFields(t *testing.T) {
	u := mustParseURL(t, "http://192.168.1.10:34400")
	out, err := BuildDeviceXML("PrettyName", "SERIAL01", u, "uuid:SERIAL01")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(out, xml.Header) {
		t.Errorf("output does not start with XML header")
	}

	cases := []string{
		"<friendlyName>PrettyName</friendlyName>",
		"<serialNumber>SERIAL01</serialNumber>",
		"<UDN>uuid:SERIAL01</UDN>",
		"<URLBase>http://192.168.1.10:34400</URLBase>",
		"<manufacturer>" + Manufacturer + "</manufacturer>",
		"<modelName>" + ModelName + "</modelName>",
		"<modelNumber>" + ModelNumber + "</modelNumber>",
	}
	for _, want := range cases {
		if !strings.Contains(out, want) {
			t.Errorf("BuildDeviceXML output missing %q", want)
		}
	}
}

func TestBuildDeviceXMLURLBaseUsesSchemeAndHost(t *testing.T) {
	u := mustParseURL(t, "http://10.0.0.1:8080/some/path?q=1")
	out, err := BuildDeviceXML("N", "S", u, "uuid:S")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// URLBase should be origin only — no path, no query
	if !strings.Contains(out, "<URLBase>http://10.0.0.1:8080</URLBase>") {
		t.Errorf("URLBase should be scheme+host only, got:\n%s", out)
	}
}

// ---- BuildDiscoverJSON -----------------------------------------------------

func TestBuildDiscoverJSONConstructsOriginOnlyURLs(t *testing.T) {
	u := mustParseURL(t, "http://192.168.1.5:34400/ignored/path")
	resp := BuildDiscoverJSON("FriendlyDev", "AABBCCDD", "auth123", u, 4)

	// URL construction should strip path and produce origin-only base
	if resp.BaseURL != "http://192.168.1.5:34400" {
		t.Errorf("BaseURL = %q, want origin-only", resp.BaseURL)
	}
	if resp.LineupURL != "http://192.168.1.5:34400/lineup.json" {
		t.Errorf("LineupURL = %q", resp.LineupURL)
	}
	if resp.FriendlyName != "FriendlyDev" {
		t.Errorf("FriendlyName = %q", resp.FriendlyName)
	}
	if resp.TunerCount != 4 {
		t.Errorf("TunerCount = %d", resp.TunerCount)
	}
}

// ---- BuildLineup -----------------------------------------------------------

func TestBuildLineupUsesChannelNumber(t *testing.T) {
	u := mustParseURL(t, "http://localhost:34400")
	ch := []channels.Channel{
		{ID: "abc", Number: "101", Name: "BBC One", SourceIndex: 0, StreamURL: "rtsp://stream"},
	}
	result := BuildLineup(ch, u)
	if len(result) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(result))
	}
	if result[0].GuideNumber != "101" {
		t.Errorf("GuideNumber = %q, want %q", result[0].GuideNumber, "101")
	}
	if result[0].GuideName != "BBC One" {
		t.Errorf("GuideName = %q, want %q", result[0].GuideName, "BBC One")
	}
}

func TestBuildLineupFallsBackToSourceIndex(t *testing.T) {
	// When Number is empty, GuideNumber should be SourceIndex+1
	u := mustParseURL(t, "http://localhost:34400")
	ch := []channels.Channel{
		{ID: "x0", Number: "", Name: "Ch A", SourceIndex: 0},
		{ID: "x1", Number: "", Name: "Ch B", SourceIndex: 4},
	}
	result := BuildLineup(ch, u)
	if result[0].GuideNumber != "1" {
		t.Errorf("fallback GuideNumber for SourceIndex 0 = %q, want \"1\"", result[0].GuideNumber)
	}
	if result[1].GuideNumber != "5" {
		t.Errorf("fallback GuideNumber for SourceIndex 4 = %q, want \"5\"", result[1].GuideNumber)
	}
}

func TestBuildLineupURLPointsToAutoEndpoint(t *testing.T) {
	u := mustParseURL(t, "http://192.168.1.1:34400")
	ch := []channels.Channel{
		{ID: "myid", Number: "1", Name: "Test", SourceIndex: 0},
	}
	result := BuildLineup(ch, u)
	wantURL := "http://192.168.1.1:34400/auto/vmyid"
	if result[0].URL != wantURL {
		t.Errorf("lineup URL = %q, want %q", result[0].URL, wantURL)
	}
}

