package httpapi

import (
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"plex-octotuner/internal/channels"
	"plex-octotuner/internal/config"
	"plex-octotuner/internal/hdhr"
)

func newTestRuntime(t *testing.T) *Runtime {
	t.Helper()
	store := channels.NewStore(&testLogger{})
	store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1 tvg-chno="101",BBC One
rtsp://10.0.0.1:554/bbc1
#EXTINF:-1 tvg-chno="102",ITV
http://10.0.0.1/itv`)

	return &Runtime{
		Config: config.Config{
			FriendlyName:      "test-tuner",
			DeviceID:          "AABB1122",
			DeviceAuth:        "auth-AABB1122",
			AdvertisedBaseURL: mustParseURL(t, "http://192.168.1.10:34400"),
			TunerCount:        2,
		},
		Logger: &testLogger{},
		Store:  store,
	}
}

// ---- /discover.json --------------------------------------------------------

func TestDiscoverJSONReturnsValidJSON(t *testing.T) {
	handler := NewHandler(newTestRuntime(t))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/discover.json", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}

	var resp hdhr.DiscoverResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp.FriendlyName != "test-tuner" {
		t.Errorf("FriendlyName = %q", resp.FriendlyName)
	}
	if resp.DeviceID != "AABB1122" {
		t.Errorf("DeviceID = %q", resp.DeviceID)
	}
	if resp.DeviceAuth != "auth-AABB1122" {
		t.Errorf("DeviceAuth = %q", resp.DeviceAuth)
	}
	if resp.TunerCount != 2 {
		t.Errorf("TunerCount = %d", resp.TunerCount)
	}
	if resp.BaseURL != "http://192.168.1.10:34400" {
		t.Errorf("BaseURL = %q", resp.BaseURL)
	}
	if resp.LineupURL != "http://192.168.1.10:34400/lineup.json" {
		t.Errorf("LineupURL = %q", resp.LineupURL)
	}
}

// ---- /device.xml -----------------------------------------------------------

func TestDeviceXMLReturnsValidXML(t *testing.T) {
	handler := NewHandler(newTestRuntime(t))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/device.xml", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/xml") {
		t.Fatalf("Content-Type = %q, want application/xml", ct)
	}

	// Should be valid XML
	type xmlRoot struct {
		XMLName     xml.Name `xml:"root"`
		FriendlyName string  `xml:"device>friendlyName"`
		SerialNumber string  `xml:"device>serialNumber"`
		UDN          string  `xml:"device>UDN"`
		URLBase      string  `xml:"URLBase"`
	}
	var root xmlRoot
	if err := xml.Unmarshal(rec.Body.Bytes(), &root); err != nil {
		t.Fatalf("invalid XML: %v\nbody: %s", err, rec.Body.String())
	}
	if root.FriendlyName != "test-tuner" {
		t.Errorf("friendlyName = %q", root.FriendlyName)
	}
	if root.SerialNumber != "AABB1122" {
		t.Errorf("serialNumber = %q", root.SerialNumber)
	}
	if root.UDN != "uuid:AABB1122" {
		t.Errorf("UDN = %q", root.UDN)
	}
}

func TestDriDeviceXMLReturnsValidXML(t *testing.T) {
	handler := NewHandler(newTestRuntime(t))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/dri/device.xml", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/xml") {
		t.Fatalf("Content-Type = %q", ct)
	}
}

// ---- /lineup.json ----------------------------------------------------------

func TestLineupJSONReturnsChannels(t *testing.T) {
	handler := NewHandler(newTestRuntime(t))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/lineup.json", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("Content-Type = %q", ct)
	}

	var lineup []hdhr.LineupEntry
	if err := json.Unmarshal(rec.Body.Bytes(), &lineup); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(lineup) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(lineup))
	}
	if lineup[0].GuideName != "BBC One" {
		t.Errorf("entry[0].GuideName = %q", lineup[0].GuideName)
	}
	if lineup[0].GuideNumber != "101" {
		t.Errorf("entry[0].GuideNumber = %q", lineup[0].GuideNumber)
	}
	if !strings.HasPrefix(lineup[0].URL, "http://192.168.1.10:34400/auto/v") {
		t.Errorf("entry[0].URL = %q", lineup[0].URL)
	}
}

func TestLineupJSONEmptyStore(t *testing.T) {
	rt := newTestRuntime(t)
	rt.Store = channels.NewStore(&testLogger{})
	handler := NewHandler(rt)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/lineup.json", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var lineup []hdhr.LineupEntry
	if err := json.Unmarshal(rec.Body.Bytes(), &lineup); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(lineup) != 0 {
		t.Fatalf("expected empty lineup, got %d entries", len(lineup))
	}
}

// ---- /lineup_status.json ---------------------------------------------------

func TestLineupStatusJSON(t *testing.T) {
	handler := NewHandler(newTestRuntime(t))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/lineup_status.json", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("Content-Type = %q", ct)
	}

	var status hdhr.LineupStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if status.ScanInProgress != 0 {
		t.Errorf("ScanInProgress = %d", status.ScanInProgress)
	}
	if status.Source != "Cable" {
		t.Errorf("Source = %q", status.Source)
	}
}

// ---- /lineup.post ----------------------------------------------------------

func TestLineupPostReturnsOK(t *testing.T) {
	handler := NewHandler(newTestRuntime(t))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/lineup.post", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

// ---- /auto/ error cases ----------------------------------------------------

func TestAutoReturns404ForMissingChannel(t *testing.T) {
	handler := NewHandler(newTestRuntime(t))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/auto/vnonexistent999", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestAutoReturns404ForMalformedSlug(t *testing.T) {
	handler := NewHandler(newTestRuntime(t))

	cases := []string{"/auto/", "/auto/x", "/auto/v"}
	for _, path := range cases {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("path %q: status = %d, want 404", path, rec.Code)
		}
	}
}
