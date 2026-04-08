package hdhr

import (
	"encoding/xml"
	"net/url"
	"plex-octotuner/internal/channels"
	"strings"
	"testing"
)

// ---- BuildDeviceUdn --------------------------------------------------------

func TestBuildDeviceUdnPrependsUUID(t *testing.T) {
	got := BuildDeviceUdn("105A1B22")
	want := "uuid:105A1B22"
	if got != want {
		t.Errorf("BuildDeviceUdn(%q) = %q, want %q", "105A1B22", got, want)
	}
}

func TestBuildDeviceUdnEmptyID(t *testing.T) {
	got := BuildDeviceUdn("")
	if got != "uuid:" {
		t.Errorf("BuildDeviceUdn(\"\") = %q, want \"uuid:\"", got)
	}
}

// ---- BuildDeviceXML --------------------------------------------------------

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("url.Parse(%q): %v", raw, err)
	}
	return u
}

func TestBuildDeviceXMLContainsXMLHeader(t *testing.T) {
	u := mustParseURL(t, "http://192.168.1.10:34400")
	out, err := BuildDeviceXML("MyTuner", "DEADBEEF", u, "uuid:DEADBEEF")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(out, xml.Header) {
		t.Errorf("output does not start with XML header, got: %q", out[:min(len(out), 80)])
	}
}

func TestBuildDeviceXMLFields(t *testing.T) {
	u := mustParseURL(t, "http://192.168.1.10:34400")
	out, err := BuildDeviceXML("PrettyName", "SERIAL01", u, "uuid:SERIAL01")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
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

func TestBuildDiscoverJSONFields(t *testing.T) {
	u := mustParseURL(t, "http://192.168.1.5:34400")
	resp := BuildDiscoverJSON("FriendlyDev", "AABBCCDD", "auth123", u, 4)

	if resp.FriendlyName != "FriendlyDev" {
		t.Errorf("FriendlyName = %q", resp.FriendlyName)
	}
	if resp.DeviceID != "AABBCCDD" {
		t.Errorf("DeviceID = %q", resp.DeviceID)
	}
	if resp.DeviceAuth != "auth123" {
		t.Errorf("DeviceAuth = %q", resp.DeviceAuth)
	}
	if resp.TunerCount != 4 {
		t.Errorf("TunerCount = %d", resp.TunerCount)
	}
	if resp.Manufacturer != Manufacturer {
		t.Errorf("Manufacturer = %q, want %q", resp.Manufacturer, Manufacturer)
	}
	if resp.ModelNumber != ModelNumber {
		t.Errorf("ModelNumber = %q, want %q", resp.ModelNumber, ModelNumber)
	}
	if resp.FirmwareName != FirmwareName {
		t.Errorf("FirmwareName = %q, want %q", resp.FirmwareName, FirmwareName)
	}
	if resp.FirmwareVersion != FirmwareVersion {
		t.Errorf("FirmwareVersion = %q, want %q", resp.FirmwareVersion, FirmwareVersion)
	}
}

func TestBuildDiscoverJSONURLs(t *testing.T) {
	u := mustParseURL(t, "http://192.168.1.5:34400")
	resp := BuildDiscoverJSON("D", "ID", "auth", u, 1)

	wantBase := "http://192.168.1.5:34400"
	if resp.BaseURL != wantBase {
		t.Errorf("BaseURL = %q, want %q", resp.BaseURL, wantBase)
	}
	wantLineup := wantBase + "/lineup.json"
	if resp.LineupURL != wantLineup {
		t.Errorf("LineupURL = %q, want %q", resp.LineupURL, wantLineup)
	}
}

func TestBuildDiscoverJSONStripsURLPath(t *testing.T) {
	// Even if baseURL has a path, BaseURL should be origin-only
	u := mustParseURL(t, "http://10.0.0.1:34400/ignored/path")
	resp := BuildDiscoverJSON("D", "ID", "auth", u, 1)

	if resp.BaseURL != "http://10.0.0.1:34400" {
		t.Errorf("BaseURL should be origin only, got %q", resp.BaseURL)
	}
}

// ---- BuildLineup -----------------------------------------------------------

func TestBuildLineupEmptyChannels(t *testing.T) {
	u := mustParseURL(t, "http://localhost:34400")
	result := BuildLineup(nil, u)
	if len(result) != 0 {
		t.Errorf("expected empty lineup, got %d entries", len(result))
	}
}

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

func TestBuildLineupPreservesOrder(t *testing.T) {
	u := mustParseURL(t, "http://localhost:34400")
	ch := []channels.Channel{
		{ID: "a", Number: "3", Name: "Third"},
		{ID: "b", Number: "1", Name: "First"},
		{ID: "c", Number: "2", Name: "Second"},
	}
	result := BuildLineup(ch, u)
	if len(result) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(result))
	}
	if result[0].GuideName != "Third" || result[1].GuideName != "First" || result[2].GuideName != "Second" {
		t.Errorf("order not preserved: %v %v %v", result[0].GuideName, result[1].GuideName, result[2].GuideName)
	}
}

// ---- BuildLineupStatus -----------------------------------------------------

func TestBuildLineupStatusFixedValues(t *testing.T) {
	s := BuildLineupStatus()
	if s.ScanInProgress != 0 {
		t.Errorf("ScanInProgress = %d, want 0", s.ScanInProgress)
	}
	if s.ScanPossible != 0 {
		t.Errorf("ScanPossible = %d, want 0", s.ScanPossible)
	}
	if s.Source != "Cable" {
		t.Errorf("Source = %q, want \"Cable\"", s.Source)
	}
	if len(s.SourceList) != 1 || s.SourceList[0] != "Cable" {
		t.Errorf("SourceList = %v, want [\"Cable\"]", s.SourceList)
	}
}

// min is available in Go 1.21+; define it for older toolchains.
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
