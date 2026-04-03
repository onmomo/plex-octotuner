package rtsp

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

type logCall struct {
	level   string
	message string
	context any
}

type testLogger struct {
	mu    sync.Mutex
	calls []logCall
}

func (l *testLogger) Info(message string, context any)  { l.append("info", message, context) }
func (l *testLogger) Warn(message string, context any)  { l.append("warn", message, context) }
func (l *testLogger) Error(message string, context any) { l.append("error", message, context) }

func (l *testLogger) append(level, message string, context any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.calls = append(l.calls, logCall{level: level, message: message, context: context})
}

func (l *testLogger) has(level, message string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, call := range l.calls {
		if call.level == level && call.message == message {
			return true
		}
	}
	return false
}

func (l *testLogger) find(level, message string) (logCall, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, call := range l.calls {
		if call.level == level && call.message == message {
			return call, true
		}
	}
	return logCall{}, false
}

func TestResolveControlURLPreservesAggregateQuery(t *testing.T) {
	base := mustParseURL(t, "rtsp://127.0.0.1:554/stream?freq=354&x_pmt=44")

	resolved := resolveControlURL("track1", base)

	if got, want := resolved.String(), "rtsp://127.0.0.1:554/track1?freq=354&x_pmt=44"; got != want {
		t.Fatalf("resolveControlURL() = %q, want %q", got, want)
	}
}

func TestUdpRtpReorderBufferReordersBurst(t *testing.T) {
	var sequences []uint16
	buffer := newUdpRtpReorderBuffer(func(packet []byte) {
		sequences = append(sequences, uint16(packet[2])<<8|uint16(packet[3]))
	})

	buffer.push(buildRtpPacket(buildTsPacket(0x11), 1))
	buffer.push(buildRtpPacket(buildTsPacket(0x22), 3))
	buffer.push(buildRtpPacket(buildTsPacket(0x33), 2))
	buffer.flushRemaining()

	if got, want := fmt.Sprint(sequences), "[1 2 3]"; got != want {
		t.Fatalf("unexpected sequence order: got %s want %s", got, want)
	}
}

func TestRelayFallsBackToUdpAndStreamsMpegTS(t *testing.T) {
	tcpPort := reserveTCPPort(t)
	serverRtpPort := reserveUDPPort(t)
	serverRtcpPort := reserveUDPPort(t)
	aggregateURL := fmt.Sprintf("rtsp://127.0.0.1:%d/stream?freq=354&msys=dvbc&pids=0,16,17,18&x_pmt=44", tcpPort)
	tsPayload := buildTsPacket(0x22)

	logger := &testLogger{}
	var mu sync.Mutex
	requests := make([]string, 0, 8)
	targets := make([]string, 0, 8)
	headers := make([]map[string]string, 0, 8)
	var udpClientPort int

	listener := mustListenTCP(t, tcpPort)
	defer listener.Close()

	sendDone := make(chan struct{})
	go serveRtspFixture(t, listener, func(method, target string, requestHeaders map[string]string, writeResponse func(string)) {
		mu.Lock()
		requests = append(requests, method)
		targets = append(targets, target)
		headers = append(headers, requestHeaders)
		mu.Unlock()

		cseq := requestHeaders["cseq"]
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
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Content-Type: application/sdp",
				fmt.Sprintf("Content-Length: %d", len(sdp)),
				"",
				sdp,
			}, "\r\n"))
		case "SETUP":
			transport := requestHeaders["transport"]
			switch {
			case strings.Contains(transport, "RTP/AVP/TCP"):
				writeResponse(strings.Join([]string{
					"RTSP/1.0 461 Unsupported Transport",
					"CSeq: " + cseq,
					"",
					"",
				}, "\r\n"))
			case strings.Contains(transport, "RTP/AVP;unicast;client_port="):
				udpClientPort = parseClientPort(t, transport)
				writeResponse(strings.Join([]string{
					"RTSP/1.0 200 OK",
					"CSeq: " + cseq,
					"Session: 12345678",
					fmt.Sprintf("Transport: RTP/AVP;unicast;client_port=%d-%d;server_port=%d-%d", udpClientPort, udpClientPort+1, serverRtpPort, serverRtcpPort),
					"",
					"",
				}, "\r\n"))
			default:
				t.Fatalf("unexpected transport header: %q", transport)
			}
		case "PLAY":
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Session: 12345678",
				"",
				"",
			}, "\r\n"))
			udpConn := mustDialUDP(t, udpClientPort)
			defer udpConn.Close()
			_, _ = udpConn.Write(buildRtpPacket(tsPayload, 1))
			close(sendDone)
		case "TEARDOWN":
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Session: 12345678",
				"",
				"",
			}, "\r\n"))
		default:
			t.Fatalf("unexpected RTSP method %q", method)
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	time.AfterFunc(200*time.Millisecond, cancel)

	recorder := httptest.NewRecorder()
	err := Relay(ctx, recorder, aggregateURL, logger)
	if err != nil {
		t.Fatalf("Relay() error = %v", err)
	}

	if got, want := recorder.Code, 200; got != want {
		t.Fatalf("status code = %d, want %d", got, want)
	}
	if got := recorder.Header().Get("Content-Type"); !strings.Contains(got, "video/mp2t") {
		t.Fatalf("content-type = %q, want video/mp2t", got)
	}
	if got := recorder.Body.String(); got != string(tsPayload) {
		t.Fatalf("unexpected body, got %d bytes", len(got))
	}

	<-sendDone

	mu.Lock()
	defer mu.Unlock()
	if got, want := requests, []string{"DESCRIBE", "SETUP", "SETUP", "SETUP", "PLAY", "TEARDOWN"}; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("unexpected request sequence: got %v want %v", got, want)
	}
	if !strings.Contains(targets[1], "freq=354") || !strings.Contains(targets[1], "x_pmt=44") {
		t.Fatalf("SETUP target did not preserve query: %q", targets[1])
	}
	if !strings.Contains(targets[4], "freq=354") || !strings.Contains(targets[4], "x_pmt=44") {
		t.Fatalf("PLAY target did not preserve query: %q", targets[4])
	}
	if !strings.Contains(targets[5], "freq=354") || !strings.Contains(targets[5], "x_pmt=44") {
		t.Fatalf("TEARDOWN target did not preserve query: %q", targets[5])
	}
	if got := headers[1]["transport"]; !strings.Contains(got, "RTP/AVP/TCP;unicast;interleaved=0-1") {
		t.Fatalf("first SETUP transport = %q", got)
	}
	if got := headers[2]["transport"]; !strings.Contains(got, "RTP/AVP/TCP;interleaved=0-1") {
		t.Fatalf("second SETUP transport = %q", got)
	}
	if got := headers[3]["transport"]; !strings.Contains(got, "client_port=") {
		t.Fatalf("UDP SETUP transport = %q", got)
	}
	if got, want := headers[5]["session"], "12345678"; got != want {
		t.Fatalf("TEARDOWN session = %q, want %q", got, want)
	}
	if !logger.has("info", "negotiated relay transport") {
		t.Fatalf("expected negotiated-transport log")
	}
	call, ok := logger.find("info", "negotiated relay transport")
	if !ok {
		t.Fatal("expected negotiated-transport log context")
	}
	contextMap, ok := call.context.(map[string]any)
	if !ok {
		t.Fatalf("unexpected negotiated-transport context type %T", call.context)
	}
	if got, want := contextMap["transport"], "udp"; got != want {
		t.Fatalf("transport log = %#v, want %q", contextMap, want)
	}
	if !logger.has("info", "rtsp relay media started") {
		t.Fatalf("expected media-start log")
	}
	if !logger.has("info", "rtsp relay media ended") {
		t.Fatalf("expected media-end summary")
	}
}

func TestRelayFallsBackWhenTcpSetupSucceedsButNegotiatesUdpTransport(t *testing.T) {
	tcpPort := reserveTCPPort(t)
	serverRtpPort := reserveUDPPort(t)
	serverRtcpPort := reserveUDPPort(t)
	aggregateURL := fmt.Sprintf("rtsp://127.0.0.1:%d/stream?freq=354&x_pmt=44", tcpPort)
	tsPayload := buildTsPacket(0x55)

	logger := &testLogger{}
	var mu sync.Mutex
	headers := make([]map[string]string, 0, 8)
	var udpClientPort int

	listener := mustListenTCP(t, tcpPort)
	defer listener.Close()

	sendDone := make(chan struct{})
	go serveRtspFixture(t, listener, func(method, target string, requestHeaders map[string]string, writeResponse func(string)) {
		mu.Lock()
		headers = append(headers, requestHeaders)
		mu.Unlock()

		cseq := requestHeaders["cseq"]
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
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Content-Type: application/sdp",
				fmt.Sprintf("Content-Length: %d", len(sdp)),
				"",
				sdp,
			}, "\r\n"))
		case "SETUP":
			transport := requestHeaders["transport"]
			switch {
			case strings.Contains(transport, "RTP/AVP/TCP"):
				writeResponse(strings.Join([]string{
					"RTSP/1.0 200 OK",
					"CSeq: " + cseq,
					"Session: 12345678",
					fmt.Sprintf("Transport: RTP/AVP;unicast;server_port=%d-%d", serverRtpPort, serverRtcpPort),
					"",
					"",
				}, "\r\n"))
			case strings.Contains(transport, "client_port="):
				udpClientPort = parseClientPort(t, transport)
				writeResponse(strings.Join([]string{
					"RTSP/1.0 200 OK",
					"CSeq: " + cseq,
					"Session: 12345678",
					fmt.Sprintf("Transport: RTP/AVP;unicast;client_port=%d-%d;server_port=%d-%d", udpClientPort, udpClientPort+1, serverRtpPort, serverRtcpPort),
					"",
					"",
				}, "\r\n"))
			default:
				t.Fatalf("unexpected transport header: %q", transport)
			}
		case "PLAY":
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Session: 12345678",
				"",
				"",
			}, "\r\n"))
			udpConn := mustDialUDP(t, udpClientPort)
			defer udpConn.Close()
			_, _ = udpConn.Write(buildRtpPacket(tsPayload, 1))
			close(sendDone)
		case "TEARDOWN":
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Session: 12345678",
				"",
				"",
			}, "\r\n"))
		default:
			t.Fatalf("unexpected RTSP method %q", method)
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	time.AfterFunc(200*time.Millisecond, cancel)

	recorder := httptest.NewRecorder()
	if err := Relay(ctx, recorder, aggregateURL, logger); err != nil {
		t.Fatalf("Relay() error = %v", err)
	}

	<-sendDone

	if got := recorder.Body.String(); got != string(tsPayload) {
		t.Fatalf("unexpected body, got %d bytes", len(got))
	}

	mu.Lock()
	defer mu.Unlock()
	sawUDPSetup := false
	for _, header := range headers {
		if transport := header["transport"]; strings.Contains(transport, "client_port=") {
			sawUDPSetup = true
		}
	}
	if !sawUDPSetup {
		t.Fatal("expected a UDP client_port SETUP after TCP candidates negotiated UDP transport")
	}
}

func TestRelayRejectsUdpSetupWithoutUsableTransportHeader(t *testing.T) {
	tcpPort := reserveTCPPort(t)
	aggregateURL := fmt.Sprintf("rtsp://127.0.0.1:%d/stream?freq=354&x_pmt=44", tcpPort)

	logger := &testLogger{}
	listener := mustListenTCP(t, tcpPort)
	defer listener.Close()

	go serveRtspFixture(t, listener, func(method, target string, requestHeaders map[string]string, writeResponse func(string)) {
		cseq := requestHeaders["cseq"]
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
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Content-Type: application/sdp",
				fmt.Sprintf("Content-Length: %d", len(sdp)),
				"",
				sdp,
			}, "\r\n"))
		case "SETUP":
			transport := requestHeaders["transport"]
			switch {
			case strings.Contains(transport, "RTP/AVP/TCP"):
				writeResponse(strings.Join([]string{
					"RTSP/1.0 461 Unsupported Transport",
					"CSeq: " + cseq,
					"",
					"",
				}, "\r\n"))
			case strings.Contains(transport, "client_port="):
				writeResponse(strings.Join([]string{
					"RTSP/1.0 200 OK",
					"CSeq: " + cseq,
					"Session: 12345678",
					"",
					"",
				}, "\r\n"))
			default:
				t.Fatalf("unexpected transport header: %q", transport)
			}
		default:
			t.Fatalf("unexpected RTSP method %q", method)
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	recorder := httptest.NewRecorder()
	err := Relay(ctx, recorder, aggregateURL, logger)
	if err == nil {
		t.Fatal("expected relay setup to fail without a usable UDP transport header")
	}
}

func TestRelaySendsTeardownOnContextCancel(t *testing.T) {
	tcpPort := reserveTCPPort(t)
	aggregateURL := fmt.Sprintf("rtsp://127.0.0.1:%d/stream?freq=354&x_pmt=44", tcpPort)
	tsPayload := buildTsPacket(0x66)

	logger := &testLogger{}
	listener := mustListenTCP(t, tcpPort)
	defer listener.Close()

	playStarted := make(chan struct{})
	teardownSeen := make(chan map[string]string, 1)

	go serveRtspFixture(t, listener, func(method, target string, requestHeaders map[string]string, writeResponse func(string)) {
		cseq := requestHeaders["cseq"]
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
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Content-Type: application/sdp",
				fmt.Sprintf("Content-Length: %d", len(sdp)),
				"",
				sdp,
			}, "\r\n"))
		case "SETUP":
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Session: 12345678",
				"Transport: RTP/AVP/TCP;interleaved=0-1",
				"",
				"",
			}, "\r\n"))
		case "PLAY":
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Session: 12345678",
				"",
				"",
			}, "\r\n"))
			writeResponse(string(buildInterleavedFrame(0, buildRtpPacket(tsPayload, 1))))
			select {
			case <-playStarted:
			default:
				close(playStarted)
			}
		case "TEARDOWN":
			select {
			case teardownSeen <- requestHeaders:
			default:
			}
			writeResponse(strings.Join([]string{
				"RTSP/1.0 200 OK",
				"CSeq: " + cseq,
				"Session: 12345678",
				"",
				"",
			}, "\r\n"))
		default:
			t.Fatalf("unexpected RTSP method %q target %q", method, target)
		}
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	recorder := httptest.NewRecorder()
	errCh := make(chan error, 1)
	go func() {
		errCh <- Relay(ctx, recorder, aggregateURL, logger)
	}()

	select {
	case <-playStarted:
	case <-time.After(time.Second):
		t.Fatal("expected PLAY to start")
	}

	deadline := time.Now().Add(time.Second)
	for !logger.has("info", "rtsp relay media started") {
		if time.Now().After(deadline) {
			t.Fatal("expected relay media to start before cancellation")
		}
		time.Sleep(10 * time.Millisecond)
	}

	cancel()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("Relay() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("expected relay to stop after context cancellation")
	}

	select {
	case headers := <-teardownSeen:
		if got, want := headers["session"], "12345678"; got != want {
			t.Fatalf("TEARDOWN session = %q, want %q", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("expected TEARDOWN after context cancellation")
	}
}

func TestRelayDiagnosticsLogsGapsAndSummary(t *testing.T) {
	logger := &testLogger{}
	diagnostics := createRelayDiagnostics(logger, "tcp", "rtsp://127.0.0.1:554/stream")

	diagnostics.recordRtpPacket(buildRtpPacket(buildTsPacket(0x11), 1))
	diagnostics.recordRtpPacket(buildRtpPacket(buildTsPacket(0x22), 3))

	badSync := make([]byte, 188)
	badSync[0] = 0x00
	diagnostics.recordTsPayload(badSync)

	pidPacket := buildTsPacket(0x33)
	pidPacket[1] = 0x00
	pidPacket[2] = 0x01
	pidPacket[3] = 0x10
	diagnostics.recordTsPayload(pidPacket)
	pidPacket[3] = 0x12
	diagnostics.recordTsPayload(pidPacket)

	diagnostics.finish()

	if !logger.has("warn", "rtsp relay detected RTP sequence gap") {
		t.Fatalf("expected RTP gap warning")
	}
	if !logger.has("warn", "rtsp relay detected MPEG-TS sync loss") {
		t.Fatalf("expected MPEG-TS sync warning")
	}
	if !logger.has("warn", "rtsp relay detected MPEG-TS continuity mismatch") {
		t.Fatalf("expected continuity warning")
	}
	if !logger.has("info", "rtsp relay media ended") {
		t.Fatalf("expected summary log")
	}
}

func TestRelayDiagnosticsIgnoresLatePacketWhenCountingLoss(t *testing.T) {
	logger := &testLogger{}
	diagnostics := createRelayDiagnostics(logger, "udp", "rtsp://127.0.0.1:554/stream")

	diagnostics.recordRtpPacket(buildRtpPacket(buildTsPacket(0x11), 2))
	diagnostics.recordRtpPacket(buildRtpPacket(buildTsPacket(0x22), 1))
	diagnostics.finish()

	if logger.has("warn", "rtsp relay detected RTP sequence gap") {
		t.Fatal("did not expect an RTP gap warning for a late packet")
	}

	call, ok := logger.find("info", "rtsp relay media ended")
	if !ok {
		t.Fatal("expected a relay summary log to inspect")
	}
	contextMap, ok := call.context.(map[string]any)
	if !ok {
		t.Fatalf("unexpected summary context type %T", call.context)
	}
	if got := contextMap["rtpMissingPacketCount"]; got != 0 {
		t.Fatalf("late packet should not count as loss: %#v", contextMap)
	}
}

func TestRelayDiagnosticsHonorsTsDiscontinuityIndicator(t *testing.T) {
	logger := &testLogger{}
	diagnostics := createRelayDiagnostics(logger, "udp", "rtsp://127.0.0.1:554/stream")

	first := buildTsPacket(0x11)
	first[1] = 0x00
	first[2] = 0x2a
	first[3] = 0x10
	diagnostics.recordTsPayload(first)

	discontinuity := buildTsPacket(0x22)
	discontinuity[1] = 0x00
	discontinuity[2] = 0x2a
	discontinuity[3] = 0x32
	discontinuity[4] = 1
	discontinuity[5] = 0x80
	diagnostics.recordTsPayload(discontinuity)
	diagnostics.finish()

	if logger.has("warn", "rtsp relay detected MPEG-TS continuity mismatch") {
		t.Fatal("did not expect a continuity warning when discontinuity_indicator is set")
	}
}

func TestRelayDiagnosticsHonorsAdaptationOnlyTsDiscontinuityIndicator(t *testing.T) {
	logger := &testLogger{}
	diagnostics := createRelayDiagnostics(logger, "udp", "rtsp://127.0.0.1:554/stream")

	first := buildTsPacket(0x11)
	first[1] = 0x00
	first[2] = 0x2b
	first[3] = 0x10
	diagnostics.recordTsPayload(first)

	adaptationOnly := buildTsPacket(0x22)
	adaptationOnly[1] = 0x00
	adaptationOnly[2] = 0x2b
	adaptationOnly[3] = 0x20
	adaptationOnly[4] = 1
	adaptationOnly[5] = 0x80
	diagnostics.recordTsPayload(adaptationOnly)

	nextPayload := buildTsPacket(0x33)
	nextPayload[1] = 0x00
	nextPayload[2] = 0x2b
	nextPayload[3] = 0x17
	diagnostics.recordTsPayload(nextPayload)
	diagnostics.finish()

	if logger.has("warn", "rtsp relay detected MPEG-TS continuity mismatch") {
		t.Fatal("did not expect a continuity warning after an adaptation-only discontinuity packet")
	}
}

func TestUdpRtpReorderBufferCloseStopsPendingFlushTimer(t *testing.T) {
	var (
		mu        sync.Mutex
		sequences []uint16
	)
	buffer := newUdpRtpReorderBuffer(func(packet []byte) {
		mu.Lock()
		defer mu.Unlock()
		sequences = append(sequences, uint16(packet[2])<<8|uint16(packet[3]))
	})

	buffer.push(buildRtpPacket(buildTsPacket(0x11), 1))
	buffer.push(buildRtpPacket(buildTsPacket(0x22), 3))
	buffer.close()
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if got, want := fmt.Sprint(sequences), "[1 3]"; got != want {
		t.Fatalf("unexpected sequence order after close: got %s want %s", got, want)
	}
}

func TestPumpUdpStopsPromptlyOnContextCancel(t *testing.T) {
	transport, err := createUdpTransport()
	if err != nil {
		t.Fatalf("createUdpTransport() error = %v", err)
	}
	defer transport.close()

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		errCh <- pumpUdp(ctx, transport, func([]byte) error { return nil })
	}()

	time.AfterFunc(50*time.Millisecond, cancel)

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("expected context cancellation error")
		}
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error = %v, want context.Canceled", err)
		}
	case <-time.After(300 * time.Millisecond):
		transport.close()
		t.Fatal("pumpUdp did not stop promptly after context cancellation")
	}
}

func TestPumpUdpReturnsHandlerError(t *testing.T) {
	transport, err := createUdpTransport()
	if err != nil {
		t.Fatalf("createUdpTransport() error = %v", err)
	}
	defer transport.close()

	sentinel := errors.New("write failed")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	errCh := make(chan error, 1)
	go func() {
		errCh <- pumpUdp(ctx, transport, func([]byte) error { return sentinel })
	}()

	sender := mustDialUDP(t, transport.clientRtpPort)
	defer sender.Close()
	if _, err := sender.Write(buildRtpPacket(buildTsPacket(0x44), 1)); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	select {
	case err := <-errCh:
		if !errors.Is(err, sentinel) {
			t.Fatalf("error = %v, want %v", err, sentinel)
		}
	case <-time.After(300 * time.Millisecond):
		transport.close()
		t.Fatal("pumpUdp did not return the handler error")
	}
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

func reserveUDPPort(t *testing.T) int {
	t.Helper()

	conn, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("ListenPacket() error = %v", err)
	}
	defer conn.Close()

	return conn.LocalAddr().(*net.UDPAddr).Port
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

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()

	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("Parse(%q) error = %v", raw, err)
	}
	return parsed
}

func mustListenTCP(t *testing.T, port int) net.Listener {
	t.Helper()

	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("Listen() error = %v", err)
	}
	return listener
}

func serveRtspFixture(t *testing.T, listener net.Listener, handle func(method, target string, requestHeaders map[string]string, writeResponse func(string))) {
	t.Helper()

	for {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		go func(c net.Conn) {
			defer c.Close()
			reader := bufio.NewReader(c)
			for {
				method, target, headers, ok := readRtspRequest(reader)
				if !ok {
					return
				}
				handle(method, target, headers, func(response string) {
					_, _ = c.Write([]byte(response))
				})
			}
		}(conn)
	}
}

func readRtspRequest(reader *bufio.Reader) (string, string, map[string]string, bool) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", "", nil, false
	}
	line = strings.TrimRight(line, "\r\n")
	if line == "" {
		return "", "", nil, false
	}

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

func parseClientPort(t *testing.T, transport string) int {
	t.Helper()

	var first, second int
	if _, err := fmt.Sscanf(transport, "RTP/AVP;unicast;client_port=%d-%d", &first, &second); err != nil {
		t.Fatalf("parse client_port from %q: %v", transport, err)
	}
	if first%2 != 0 {
		t.Fatalf("expected even RTP port, got %d", first)
	}
	if second != first+1 {
		t.Fatalf("expected RTCP port %d, got %d", first+1, second)
	}
	return first
}

func mustDialUDP(t *testing.T, port int) *net.UDPConn {
	t.Helper()

	conn, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: port})
	if err != nil {
		t.Fatalf("DialUDP() error = %v", err)
	}
	return conn
}
