package httpapi

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"plex-octotuner/internal/channels"
	"plex-octotuner/internal/config"
)

type testLogger struct {
	mu    sync.Mutex
	calls []string
}

func (l *testLogger) Info(message string, context any)  { l.append(message) }
func (l *testLogger) Warn(message string, context any)  { l.append(message) }
func (l *testLogger) Error(message string, context any) { l.append(message) }

func (l *testLogger) append(message string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.calls = append(l.calls, message)
}

func TestHandlePlaybackRedirectsHttpUpstream(t *testing.T) {
	store := channels.NewStore(&testLogger{})
	store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1,HTTP Channel
http://example.com/stream`)

	handler := NewHandler(&Runtime{
		Config: config.Config{
			FriendlyName:      "octotuner",
			DeviceID:          "105A1B22",
			DeviceAuth:        "octotuner-105A1B22",
			AdvertisedBaseURL: mustParseURL(t, "http://127.0.0.1:34400"),
			TunerCount:        4,
		},
		Logger: &testLogger{},
		Store:  store,
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/auto/v"+store.GetChannels()[0].ID, nil)

	handler.ServeHTTP(recorder, request)

	if got, want := recorder.Code, http.StatusFound; got != want {
		t.Fatalf("status code = %d, want %d", got, want)
	}
	if got, want := recorder.Header().Get("Location"), "http://example.com/stream"; got != want {
		t.Fatalf("location = %q, want %q", got, want)
	}
	if got, want := recorder.Header().Get("Cache-Control"), "no-store"; got != want {
		t.Fatalf("cache-control = %q, want %q", got, want)
	}
}

func TestHandlePlaybackRelaysRtspUpstream(t *testing.T) {
	tcpPort := reserveTCPPort(t)
	aggregateURL := fmt.Sprintf("rtsp://127.0.0.1:%d/stream?freq=354&x_pmt=44", tcpPort)
	tsPayload := buildTsPacket(0x22)

	listener := mustListenTCP(t, tcpPort)
	defer listener.Close()

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				reader := bufio.NewReader(c)
				for {
					method, _, headers, ok := readRTSPRequest(reader)
					if !ok {
						return
					}
					cseq := headers["cseq"]
					if cseq == "" {
						cseq = "1"
					}
					switch method {
					case "DESCRIBE":
						sdp := strings.Join([]string{
							"v=0",
							"o=- 0 0 IN IP4 127.0.0.1",
							"s=octopus",
							"t=0 0",
							"a=control:*",
							"m=video 0 RTP/AVP 33",
							"c=IN IP4 0.0.0.0",
							"a=control:track1",
						}, "\r\n")
						writeRTSPResponse(c, strings.Join([]string{
							"RTSP/1.0 200 OK",
							"CSeq: " + cseq,
							"Content-Type: application/sdp",
							fmt.Sprintf("Content-Length: %d", len(sdp)),
							"",
							sdp,
						}, "\r\n"))
					case "SETUP":
						transport := headers["transport"]
						if strings.Contains(transport, "RTP/AVP/TCP;unicast;interleaved=0-1") {
							writeRTSPResponse(c, strings.Join([]string{
								"RTSP/1.0 200 OK",
								"CSeq: " + cseq,
								"Session: 12345678",
								"Transport: RTP/AVP/TCP;interleaved=0-1",
								"",
								"",
							}, "\r\n"))
							continue
						}
						t.Fatalf("unexpected transport header: %q", transport)
					case "PLAY":
						writeRTSPResponse(c, strings.Join([]string{
							"RTSP/1.0 200 OK",
							"CSeq: " + cseq,
							"Session: 12345678",
							"",
							"",
						}, "\r\n"))
						_, _ = c.Write(buildInterleavedFrame(0, buildRtpPacket(tsPayload, 1)))
						return
					default:
						t.Fatalf("unexpected RTSP method %q", method)
					}
				}
			}(conn)
		}
	}()

	store := channels.NewStore(&testLogger{})
	store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1,RTSP Channel
` + aggregateURL)

	logger := &testLogger{}
	handler := NewHandler(&Runtime{
		Config: config.Config{
			FriendlyName:      "octotuner",
			DeviceID:          "105A1B22",
			DeviceAuth:        "octotuner-105A1B22",
			AdvertisedBaseURL: mustParseURL(t, "http://127.0.0.1:34400"),
			TunerCount:        4,
		},
		Logger: logger,
		Store:  store,
	})

	request := httptest.NewRequest(http.MethodGet, "/auto/v"+store.GetChannels()[0].ID, nil)
	ctx, cancel := context.WithTimeout(request.Context(), time.Second)
	defer cancel()
	request = request.WithContext(ctx)

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if got, want := recorder.Code, http.StatusOK; got != want {
		t.Fatalf("status code = %d, want %d", got, want)
	}
	if got := recorder.Header().Get("Content-Type"); !strings.Contains(got, "video/mp2t") {
		t.Fatalf("content-type = %q, want video/mp2t", got)
	}
	if got := recorder.Body.String(); got != string(tsPayload) {
		t.Fatalf("unexpected body, got %d bytes", len(got))
	}
}

func TestHandlePlaybackReturnsErrorWhenRtspRelayEndsBeforeFirstMedia(t *testing.T) {
	tcpPort := reserveTCPPort(t)
	aggregateURL := fmt.Sprintf("rtsp://127.0.0.1:%d/stream?freq=354&x_pmt=44", tcpPort)

	listener := mustListenTCP(t, tcpPort)
	defer listener.Close()

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				reader := bufio.NewReader(c)
				for {
					method, _, headers, ok := readRTSPRequest(reader)
					if !ok {
						return
					}
					cseq := headers["cseq"]
					if cseq == "" {
						cseq = "1"
					}
					switch method {
					case "DESCRIBE":
						sdp := strings.Join([]string{
							"v=0",
							"o=- 0 0 IN IP4 127.0.0.1",
							"s=octopus",
							"t=0 0",
							"a=control:*",
							"m=video 0 RTP/AVP 33",
							"c=IN IP4 0.0.0.0",
							"a=control:track1",
						}, "\r\n")
						writeRTSPResponse(c, strings.Join([]string{
							"RTSP/1.0 200 OK",
							"CSeq: " + cseq,
							"Content-Type: application/sdp",
							fmt.Sprintf("Content-Length: %d", len(sdp)),
							"",
							sdp,
						}, "\r\n"))
					case "SETUP":
						writeRTSPResponse(c, strings.Join([]string{
							"RTSP/1.0 200 OK",
							"CSeq: " + cseq,
							"Session: 12345678",
							"Transport: RTP/AVP/TCP;interleaved=0-1",
							"",
							"",
						}, "\r\n"))
					case "PLAY":
						writeRTSPResponse(c, strings.Join([]string{
							"RTSP/1.0 200 OK",
							"CSeq: " + cseq,
							"Session: 12345678",
							"",
							"",
						}, "\r\n"))
						return
					default:
						t.Fatalf("unexpected RTSP method %q", method)
					}
				}
			}(conn)
		}
	}()

	store := channels.NewStore(&testLogger{})
	store.ReplaceFromRaw(`#EXTM3U
#EXTINF:-1,RTSP Channel
` + aggregateURL)

	logger := &testLogger{}
	handler := NewHandler(&Runtime{
		Config: config.Config{
			FriendlyName:      "octotuner",
			DeviceID:          "105A1B22",
			DeviceAuth:        "octotuner-105A1B22",
			AdvertisedBaseURL: mustParseURL(t, "http://127.0.0.1:34400"),
			TunerCount:        4,
		},
		Logger: logger,
		Store:  store,
	})

	request := httptest.NewRequest(http.MethodGet, "/auto/v"+store.GetChannels()[0].ID, nil)
	ctx, cancel := context.WithTimeout(request.Context(), 250*time.Millisecond)
	defer cancel()
	request = request.WithContext(ctx)

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if got, want := recorder.Code, http.StatusInternalServerError; got != want {
		t.Fatalf("status code = %d, want %d", got, want)
	}
	if got := recorder.Header().Get("Content-Type"); strings.Contains(got, "video/mp2t") {
		t.Fatalf("unexpected content-type after pre-media failure: %q", got)
	}
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()

	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("Parse(%q) error = %v", raw, err)
	}
	return parsed
}

func reserveTCPPort(t *testing.T) int {
	t.Helper()

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen() error = %v", err)
	}
	defer listener.Close()

	return listener.Addr().(*net.TCPAddr).Port
}

func mustListenTCP(t *testing.T, port int) net.Listener {
	t.Helper()

	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("Listen() error = %v", err)
	}
	return listener
}

func readRTSPRequest(reader *bufio.Reader) (string, string, map[string]string, bool) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", "", nil, false
	}
	line = strings.TrimRight(line, "\r\n")
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return "", "", nil, false
	}

	headers := make(map[string]string)
	for {
		headerLine, err := reader.ReadString('\n')
		if err != nil {
			return "", "", nil, false
		}
		headerLine = strings.TrimRight(headerLine, "\r\n")
		if headerLine == "" {
			break
		}
		if idx := strings.IndexByte(headerLine, ':'); idx > 0 {
			headers[strings.ToLower(strings.TrimSpace(headerLine[:idx]))] = strings.TrimSpace(headerLine[idx+1:])
		}
	}

	return fields[0], fields[1], headers, true
}

func writeRTSPResponse(conn net.Conn, response string) {
	_, _ = conn.Write([]byte(response))
}

func buildTsPacket(value byte) []byte {
	packet := make([]byte, 188)
	packet[0] = 0x47
	for i := 1; i < len(packet); i++ {
		packet[i] = value
	}
	return packet
}

func buildRtpPacket(payload []byte, sequenceNumber uint16) []byte {
	header := make([]byte, 12)
	header[0] = 0x80
	header[1] = 33
	header[2] = byte(sequenceNumber >> 8)
	header[3] = byte(sequenceNumber)
	return append(header, payload...)
}

func buildInterleavedFrame(channel byte, payload []byte) []byte {
	frame := make([]byte, 4+len(payload))
	frame[0] = 0x24
	frame[1] = channel
	frame[2] = byte(len(payload) >> 8)
	frame[3] = byte(len(payload))
	copy(frame[4:], payload)
	return frame
}
