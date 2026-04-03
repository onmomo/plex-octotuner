package channels

import "testing"

type testLogger struct{}

func (testLogger) Warn(message string, context any) {}

func TestParseM3URetainsRTSPChannelsAndFallbackNumbers(t *testing.T) {
	playlist := `#EXTM3U
#EXTINF:-1 tvg-chno="201",Quoted Comma Channel
http://example.com/stream/1
#EXTINF:-1,SUPER RTL HD CH
rtsp://10.0.1.195:554/?freq=354&x_pmt=44`

	channels := ParseM3U(playlist, testLogger{})
	if len(channels) != 2 {
		t.Fatalf("expected 2 channels, got %d", len(channels))
	}
	if channels[1].StreamURL != "rtsp://10.0.1.195:554/?freq=354&x_pmt=44" {
		t.Fatalf("expected rtsp stream to be retained, got %q", channels[1].StreamURL)
	}
	if channels[0].Number != "201" {
		t.Fatalf("expected tvg-chno to be preserved, got %q", channels[0].Number)
	}
}

func TestBuildChannelIdentityUsesStableTvgIDKey(t *testing.T) {
	identity := BuildChannelIdentity("DasErste.de", "", "Das Erste HD", "http://example.com/stream")
	if identity.Key != "tvg-id:daserste-de" {
		t.Fatalf("unexpected identity key: %q", identity.Key)
	}
}
