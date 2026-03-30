package discovery

import (
	"encoding/hex"
	"net/url"
	"strings"
	"testing"

	"plex-octotuner/internal/config"
)

func testConfig() config.Config {
	baseURL, err := url.Parse("http://192.168.1.50:34400")
	if err != nil {
		panic(err)
	}

	return config.Config{
		AdvertisedBaseURL: baseURL,
		DeviceID:          "105A1B22",
		DeviceAuth:        "octotuner-105A1B22",
		TunerCount:        4,
		FriendlyName:      "octotuner",
	}
}

func decodePacketTags(t *testing.T, packet []byte) map[byte][]byte {
	t.Helper()

	if got := readUint16BE(packet, 0); got != hdhomerunTypeDiscoverReply {
		t.Fatalf("frame type = %#x, want %#x", got, hdhomerunTypeDiscoverReply)
	}

	payloadLength := int(readUint16BE(packet, 2))
	if len(packet) != 4+payloadLength+4 {
		t.Fatalf("packet length = %d, want %d", len(packet), 4+payloadLength+4)
	}

	decoded := map[byte][]byte{}
	offset := 4
	limit := 4 + payloadLength
	for offset < limit {
		tag := packet[offset]
		offset++
		length := readHdhomerunVarLength(packet, offset)
		if length == nil {
			t.Fatalf("failed to read length at offset %d", offset)
		}
		offset += length.byteLength
		decoded[tag] = append([]byte(nil), packet[offset:offset+length.value]...)
		offset += length.value
	}

	return decoded
}

func TestBuildSsdpPackets(t *testing.T) {
	cfg := testConfig()

	got := buildSsdpNotifyPackets(cfg)
	want := []string{
		"NOTIFY * HTTP/1.1\r\n" +
			"HOST: 239.255.255.250:1900\r\n" +
			"NT: upnp:rootdevice\r\n" +
			"NTS: ssdp:alive\r\n" +
			"USN: uuid:105A1B22::upnp:rootdevice\r\n" +
			"LOCATION: http://192.168.1.50:34400/device.xml\r\n" +
			"SERVER: xTeVe\r\n" +
			"CACHE-CONTROL: max-age=1800\r\n\r\n",
	}
	if len(got) != len(want) || got[0] != want[0] {
		t.Fatalf("notify packet mismatch:\n got: %q\nwant: %q", got, want)
	}

	cases := map[string]string{
		"upnp:rootdevice": "ST: upnp:rootdevice",
		"ssdp:all":        "ST: upnp:rootdevice",
	}
	for searchTarget, wantST := range cases {
		got := buildSsdpSearchResponses(cfg, searchTarget)
		if len(got) != 1 {
			t.Fatalf("search target %q produced %d packets, want 1", searchTarget, len(got))
		}
		if got[0] == "" || !containsLine(got[0], wantST) {
			t.Fatalf("response for %q missing %q", searchTarget, wantST)
		}
	}

	if got := buildSsdpSearchResponses(cfg, "urn:ignored"); len(got) != 0 {
		t.Fatalf("unsupported target produced %d packets", len(got))
	}
}

func TestDiscoveryPacketsUseOriginOnlyURLsWhenBaseURLHasTrailingSlash(t *testing.T) {
	cfg := testConfig()
	cfg.AdvertisedBaseURL = mustParseURL(t, "http://192.168.1.50:34400/")

	notifyPackets := buildSsdpNotifyPackets(cfg)
	if len(notifyPackets) != 1 {
		t.Fatalf("notify packets = %d, want 1", len(notifyPackets))
	}
	if !containsLine(notifyPackets[0], "LOCATION: http://192.168.1.50:34400/device.xml") {
		t.Fatalf("notify packet location was not normalized: %q", notifyPackets[0])
	}
	if strings.Contains(notifyPackets[0], "//device.xml") {
		t.Fatalf("notify packet contains double slash location: %q", notifyPackets[0])
	}

	decoded := decodePacketTags(t, buildHdhomerunDiscoveryReply(cfg))
	if got := string(decoded[hdhomerunTagBaseURL]); got != "http://192.168.1.50:34400" {
		t.Fatalf("base url = %q, want %q", got, "http://192.168.1.50:34400")
	}
	if got := string(decoded[hdhomerunTagLineupURL]); got != "http://192.168.1.50:34400/lineup.json" {
		t.Fatalf("lineup url = %q, want %q", got, "http://192.168.1.50:34400/lineup.json")
	}
}

func TestBuildHdhomerunDiscoveryReply(t *testing.T) {
	cfg := testConfig()
	packet := buildHdhomerunDiscoveryReply(cfg)
	decoded := decodePacketTags(t, packet)

	if got := strings.ToUpper(hex.EncodeToString(decoded[hdhomerunTagDeviceID])); got != cfg.DeviceID {
		t.Fatalf("device id = %s, want %s", got, cfg.DeviceID)
	}
	if got := readUint32BE(decoded[hdhomerunTagDeviceType], 0); got != hdhomerunDeviceTypeTuner {
		t.Fatalf("device type = %#x, want %#x", got, hdhomerunDeviceTypeTuner)
	}
	if got := decoded[hdhomerunTagTunerCount][0]; got != byte(cfg.TunerCount) {
		t.Fatalf("tuner count = %d, want %d", got, cfg.TunerCount)
	}
	if got := string(decoded[hdhomerunTagDeviceAuth]); got != cfg.DeviceAuth {
		t.Fatalf("device auth = %q, want %q", got, cfg.DeviceAuth)
	}
	if got := string(decoded[hdhomerunTagBaseURL]); got != cfg.AdvertisedBaseURL.String() {
		t.Fatalf("base url = %q, want %q", got, cfg.AdvertisedBaseURL.String())
	}
	if got := string(decoded[hdhomerunTagLineupURL]); got != cfg.AdvertisedBaseURL.String()+"/lineup.json" {
		t.Fatalf("lineup url = %q, want %q", got, cfg.AdvertisedBaseURL.String()+"/lineup.json")
	}
	if got, want := readUint32LE(packet, len(packet)-4), crc32IEEE(packet[:len(packet)-4]); got != want {
		t.Fatalf("crc = %#x, want %#x", got, want)
	}
}

func TestParseHdhomerunDiscoveryRequestMatchesConfig(t *testing.T) {
	cfg := testConfig()
	packet := buildDiscoveryRequest([]uint32{hdhomerunDeviceTypeTuner}, 0xFFFFFFFF)
	request, ok := parseHdhomerunDiscoveryRequest(packet)
	if !ok {
		t.Fatal("expected request to parse")
	}
	if !requestMatchesConfig(*request, cfg) {
		t.Fatal("expected wildcard request to match config")
	}

	packet = buildDiscoveryRequest([]uint32{hdhomerunDeviceTypeStorage}, 0xFFFFFFFF)
	request, ok = parseHdhomerunDiscoveryRequest(packet)
	if !ok {
		t.Fatal("expected request to parse")
	}
	if requestMatchesConfig(*request, cfg) {
		t.Fatal("expected storage request to be rejected")
	}

	packet = buildDiscoveryRequest([]uint32{hdhomerunDeviceTypeTuner}, mustParseHexDeviceID(t, "DEADBEEF"))
	request, ok = parseHdhomerunDiscoveryRequest(packet)
	if !ok {
		t.Fatal("expected request to parse")
	}
	if requestMatchesConfig(*request, cfg) {
		t.Fatal("expected mismatched device id to be rejected")
	}
}

func containsLine(packet string, wantLine string) bool {
	return strings.Contains(packet, wantLine)
}
