package rtsp

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Logger interface {
	Info(message string, context any)
	Warn(message string, context any)
	Error(message string, context any)
}

type rtspResponse struct {
	statusCode int
	headers    map[string]string
	body       []byte
}

type mediaTrack struct {
	setupURL *url.URL
	playURL  *url.URL
}

type relayTransport struct {
	kind           string
	rtpSocket      *net.UDPConn
	rtcpSocket     *net.UDPConn
	clientRtpPort  int
	clientRtcpPort int
}

var tcpTransportCandidates = []string{
	"RTP/AVP/TCP;unicast;interleaved=0-1",
	"RTP/AVP/TCP;interleaved=0-1",
}

func Relay(ctx context.Context, w http.ResponseWriter, streamURL string, logger Logger) error {
	parsedURL, err := url.Parse(streamURL)
	if err != nil {
		return err
	}
	if parsedURL.Scheme != "rtsp" && parsedURL.Scheme != "rtsps" {
		return fmt.Errorf("unsupported RTSP scheme %q", parsedURL.Scheme)
	}

	socket, err := connectRtspSocket(parsedURL)
	if err != nil {
		return err
	}
	defer socket.Close()

	connection := newRtspConnection(socket)
	closed := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = socket.Close()
		case <-closed:
		}
	}()
	defer close(closed)

	describe, err := connection.request("DESCRIBE", parsedURL, map[string]string{
		"Accept": "application/sdp",
	})
	if err != nil {
		return err
	}

	track, err := parseSdpTrack(string(describe.body), parsedURL)
	if err != nil {
		return err
	}

	setupResp, transport, err := negotiateTransport(ctx, connection, logger, track.setupURL)
	if err != nil {
		return err
	}

	sessionID, err := parseSessionID(setupResp)
	if err != nil {
		return err
	}

	if transport.kind == "udp" {
		defer transport.close()
	}

	playResp, err := connection.request("PLAY", track.playURL, map[string]string{
		"Session": sessionID,
	})
	if err != nil {
		return err
	}
	_ = playResp

	diagnostics := createRelayDiagnostics(logger, transport.kind, streamURL)
	started, err := streamMedia(ctx, connection, transport, w, diagnostics, logger, streamURL)
	if err != nil {
		if started {
			logger.Error("rtsp relay failed", err)
			return nil
		}
		return err
	}
	return nil
}

func connectRtspSocket(streamURL *url.URL) (net.Conn, error) {
	port := streamURL.Port()
	if port == "" {
		if streamURL.Scheme == "rtsps" {
			port = "322"
		} else {
			port = "554"
		}
	}
	address := net.JoinHostPort(streamURL.Hostname(), port)

	if streamURL.Scheme == "rtsps" {
		return tls.Dial("tcp", address, &tls.Config{ServerName: streamURL.Hostname()})
	}
	return net.Dial("tcp", address)
}

func negotiateTransport(ctx context.Context, connection *rtspConnection, logger Logger, setupURL *url.URL) (*rtspResponse, *relayTransport, error) {
	for _, candidate := range tcpTransportCandidates {
		resp, err := connection.request("SETUP", setupURL, map[string]string{
			"Transport": candidate,
		})
		if err == nil {
			parsedKind, parseErr := parseNegotiatedTransport(resp)
			if parseErr == nil && parsedKind == "tcp" {
				logger.Info("negotiated relay transport", map[string]any{
					"transport":   "tcp",
					"upstreamUrl": setupURL.String(),
				})
				return resp, &relayTransport{kind: "tcp"}, nil
			}
			if parseErr != nil {
				continue
			}
			continue
		}
	}

	transport, err := createUdpTransport()
	if err != nil {
		return nil, nil, err
	}

	resp, err := connection.request("SETUP", setupURL, map[string]string{
		"Transport": fmt.Sprintf("RTP/AVP;unicast;client_port=%d-%d", transport.clientRtpPort, transport.clientRtcpPort),
	})
	if err != nil {
		transport.close()
		return nil, nil, err
	}

	parsedKind, parseErr := parseNegotiatedTransport(resp)
	if parseErr != nil {
		transport.close()
		return nil, nil, parseErr
	}
	if parsedKind == "tcp" {
		transport.close()
		logger.Info("negotiated relay transport", map[string]any{
			"transport":   "tcp",
			"upstreamUrl": setupURL.String(),
		})
		return resp, &relayTransport{kind: "tcp"}, nil
	}
	logger.Info("negotiated relay transport", map[string]any{
		"transport":   "udp",
		"upstreamUrl": setupURL.String(),
	})

	return resp, transport, nil
}

func parseNegotiatedTransport(resp *rtspResponse) (string, error) {
	transportHeader := strings.ToLower(strings.TrimSpace(resp.headers["transport"]))
	if transportHeader == "" {
		return "", errors.New("rtsp setup response missing transport header")
	}
	if strings.Contains(transportHeader, "rtp/avp/tcp") {
		return "tcp", nil
	}
	if !strings.Contains(transportHeader, "rtp/avp") || !strings.Contains(transportHeader, "unicast") {
		return "", fmt.Errorf("rtsp setup response negotiated unsupported transport %q", resp.headers["transport"])
	}
	return "udp", nil
}

func parseSessionID(resp *rtspResponse) (string, error) {
	value := resp.headers["session"]
	if value == "" {
		return "", errors.New("rtsp setup response missing session header")
	}
	return strings.Split(value, ";")[0], nil
}

func createUdpTransport() (*relayTransport, error) {
	for attempt := 0; attempt < 10; attempt++ {
		rtpConn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
		if err != nil {
			continue
		}
		clientRtpPort := rtpConn.LocalAddr().(*net.UDPAddr).Port
		if clientRtpPort%2 != 0 {
			_ = rtpConn.Close()
			continue
		}
		clientRtcpPort := clientRtpPort + 1
		rtcpConn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: clientRtcpPort})
		if err != nil {
			_ = rtpConn.Close()
			continue
		}
		return &relayTransport{
			kind:           "udp",
			rtpSocket:      rtpConn,
			rtcpSocket:     rtcpConn,
			clientRtpPort:  clientRtpPort,
			clientRtcpPort: clientRtcpPort,
		}, nil
	}

	return nil, errors.New("rtsp relay failed to reserve a SAT>IP UDP port pair")
}

func (t *relayTransport) close() {
	if t == nil {
		return
	}
	if t.rtpSocket != nil {
		_ = t.rtpSocket.Close()
	}
	if t.rtcpSocket != nil {
		_ = t.rtcpSocket.Close()
	}
}

func streamMedia(
	ctx context.Context,
	connection *rtspConnection,
	transport *relayTransport,
	w http.ResponseWriter,
	diagnostics *relayDiagnostics,
	logger Logger,
	streamURL string,
) (bool, error) {
	started := false
	emitStart := func() {
		if started {
			return
		}
		started = true
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "video/mp2t")
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		logger.Info("rtsp relay media started", map[string]any{
			"transport":   transport.kind,
			"upstreamUrl": streamURL,
		})
	}

	switch transport.kind {
	case "tcp":
		err := connection.pumpInterleaved(ctx, func(packet []byte) error {
			diagnostics.recordRtpPacket(packet)
			payload, err := depacketizeRtpPayload(packet)
			if err != nil {
				return err
			}
			if len(payload) == 0 {
				return nil
			}
			diagnostics.recordTsPayload(payload)
			emitStart()
			_, err = w.Write(payload)
			if err == nil {
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
			}
			return err
		})
		diagnostics.finish()
		if err == nil {
			return started, nil
		}
		if !started {
			return false, err
		}
		if ctx.Err() != nil || errors.Is(err, net.ErrClosed) || errors.Is(err, io.EOF) {
			return true, nil
		}
		return true, err
	case "udp":
		err := pumpUdp(ctx, transport, func(packet []byte) error {
			diagnostics.recordRtpPacket(packet)
			payload, err := depacketizeRtpPayload(packet)
			if err != nil {
				return err
			}
			if len(payload) == 0 {
				return nil
			}
			diagnostics.recordTsPayload(payload)
			emitStart()
			_, err = w.Write(payload)
			if err == nil {
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
			}
			return err
		})
		diagnostics.finish()
		if err == nil {
			return started, nil
		}
		if !started {
			return false, err
		}
		if ctx.Err() != nil || errors.Is(err, net.ErrClosed) || errors.Is(err, io.EOF) {
			return true, nil
		}
		return true, err
	default:
		diagnostics.finish()
		return false, fmt.Errorf("unsupported relay transport %q", transport.kind)
	}
}

func depacketizeRtpPayload(packet []byte) ([]byte, error) {
	if len(packet) < 12 {
		return nil, errors.New("rtsp relay received a truncated RTP packet")
	}
	if packet[0]>>6 != rtpVersion {
		return nil, errors.New("rtsp relay received an unsupported RTP version")
	}

	hasPadding := packet[0]&0x20 != 0
	hasExtension := packet[0]&0x10 != 0
	csrcCount := int(packet[0] & 0x0f)
	headerLength := 12 + csrcCount*4
	if len(packet) < headerLength {
		return nil, errors.New("rtsp relay received a truncated RTP header")
	}
	if hasExtension {
		if len(packet) < headerLength+4 {
			return nil, errors.New("rtsp relay received a truncated RTP extension header")
		}
		extensionLength := int(packet[headerLength+2])<<8 | int(packet[headerLength+3])
		headerLength += 4 + extensionLength*4
	}
	if len(packet) < headerLength {
		return nil, errors.New("rtsp relay received a truncated RTP payload")
	}

	payloadLength := len(packet) - headerLength
	if hasPadding {
		paddingLength := int(packet[len(packet)-1])
		if paddingLength > payloadLength {
			return nil, errors.New("rtsp relay received invalid RTP padding")
		}
		payloadLength -= paddingLength
	}

	return packet[headerLength : headerLength+payloadLength], nil
}

func parseSdpTrack(body string, streamURL *url.URL) (*mediaTrack, error) {
	lines := strings.Split(body, "\n")
	var aggregateControl string
	var sections []mediaSection
	var current *mediaSection

	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "m="):
			parts := strings.Fields(line[2:])
			current = &mediaSection{rtpmap: map[int]string{}}
			for _, part := range parts[3:] {
				if payload, err := strconv.Atoi(part); err == nil {
					current.payloadTypes = append(current.payloadTypes, payload)
				}
			}
			sections = append(sections, *current)
		case strings.HasPrefix(line, "a=control:"):
			control := strings.TrimPrefix(line, "a=control:")
			if current != nil {
				sections[len(sections)-1].control = control
			} else {
				aggregateControl = control
			}
		case strings.HasPrefix(line, "a=rtpmap:") && current != nil:
			rest := strings.TrimPrefix(line, "a=rtpmap:")
			fields := strings.Fields(rest)
			if len(fields) < 2 {
				continue
			}
			payloadType, err := strconv.Atoi(fields[0])
			if err != nil {
				continue
			}
			if len(sections) > 0 {
				section := sections[len(sections)-1]
				section.rtpmap[payloadType] = strings.ToUpper(fields[1])
				sections[len(sections)-1] = section
			}
		}
	}

	var matched *mediaSection
	for i := range sections {
		section := &sections[i]
		if containsInt(section.payloadTypes, 33) {
			matched = section
			break
		}
		for _, payloadType := range section.payloadTypes {
			if strings.HasPrefix(section.rtpmap[payloadType], "MP2T/") {
				matched = section
				break
			}
		}
		if matched != nil {
			break
		}
	}

	if matched == nil || matched.control == "" {
		return nil, errors.New("rtsp relay requires an MPEG-TS media track with a control URL")
	}

	return &mediaTrack{
		setupURL: resolveControlURL(matched.control, streamURL),
		playURL:  resolveControlURL(firstNonEmpty(aggregateControl, matched.control), streamURL),
	}, nil
}

type rtspConnection struct {
	conn   net.Conn
	buffer []byte
	cseq   int
}

func newRtspConnection(conn net.Conn) *rtspConnection {
	return &rtspConnection{conn: conn, cseq: 1}
}

func (c *rtspConnection) request(method string, url *url.URL, headers map[string]string) (*rtspResponse, error) {
	request := strings.Builder{}
	request.WriteString(method)
	request.WriteByte(' ')
	request.WriteString(url.String())
	request.WriteString(" RTSP/1.0\r\n")
	request.WriteString(fmt.Sprintf("CSeq: %d\r\n", c.cseq))
	c.cseq++
	request.WriteString("User-Agent: plex-octotuner\r\n")
	for key, value := range headers {
		request.WriteString(key)
		request.WriteString(": ")
		request.WriteString(value)
		request.WriteString("\r\n")
	}
	request.WriteString("\r\n")

	if _, err := io.WriteString(c.conn, request.String()); err != nil {
		return nil, err
	}

	resp, err := c.readResponse()
	if err != nil {
		return nil, err
	}
	if resp.statusCode < 200 || resp.statusCode >= 300 {
		return nil, fmt.Errorf("rtsp %s failed with status %d", method, resp.statusCode)
	}
	return resp, nil
}

func (c *rtspConnection) pumpInterleaved(ctx context.Context, handle func([]byte) error) error {
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		if len(c.buffer) == 0 {
			if err := c.readMore(ctx); err != nil {
				return err
			}
			continue
		}

		if strings.HasPrefix(string(c.buffer), "RTSP/1.0") {
			if _, err := c.readResponse(); err != nil {
				return err
			}
			continue
		}

		if c.buffer[0] != interleavedFrameMarker {
			if err := c.readMore(ctx); err != nil {
				return err
			}
			continue
		}

		if len(c.buffer) < 4 {
			if err := c.readMore(ctx); err != nil {
				return err
			}
			continue
		}

		frameLength := int(c.buffer[2])<<8 | int(c.buffer[3])
		totalLength := 4 + frameLength
		if len(c.buffer) < totalLength {
			if err := c.readMore(ctx); err != nil {
				return err
			}
			continue
		}

		channel := c.buffer[1]
		payload := make([]byte, frameLength)
		copy(payload, c.buffer[4:totalLength])
		c.buffer = c.buffer[totalLength:]
		if channel%2 != 0 {
			continue
		}
		if err := handle(payload); err != nil {
			return err
		}
	}
}

func (c *rtspConnection) readResponse() (*rtspResponse, error) {
	for {
		headerEnd := strings.Index(string(c.buffer), "\r\n\r\n")
		if headerEnd >= 0 {
			headerText := string(c.buffer[:headerEnd])
			lines := strings.Split(headerText, "\r\n")
			if len(lines) == 0 {
				return nil, errors.New("rtsp relay received an empty response")
			}
			statusFields := strings.Fields(lines[0])
			if len(statusFields) < 2 {
				return nil, errors.New("rtsp relay received an invalid RTSP status line")
			}
			statusCode, err := strconv.Atoi(statusFields[1])
			if err != nil {
				return nil, err
			}
			headers := map[string]string{}
			for _, line := range lines[1:] {
				if idx := strings.IndexByte(line, ':'); idx > 0 {
					headers[strings.ToLower(strings.TrimSpace(line[:idx]))] = strings.TrimSpace(line[idx+1:])
				}
			}
			bodyStart := headerEnd + 4
			contentLength := 0
			if raw := headers["content-length"]; raw != "" {
				contentLength, _ = strconv.Atoi(raw)
			}
			for len(c.buffer) < bodyStart+contentLength {
				if err := c.readMore(context.Background()); err != nil {
					return nil, err
				}
			}
			body := make([]byte, contentLength)
			copy(body, c.buffer[bodyStart:bodyStart+contentLength])
			c.buffer = c.buffer[bodyStart+contentLength:]
			return &rtspResponse{statusCode: statusCode, headers: headers, body: body}, nil
		}
		if err := c.readMore(context.Background()); err != nil {
			return nil, err
		}
	}
}

func (c *rtspConnection) readMore(ctx context.Context) error {
	tmp := make([]byte, 4096)
	type readResult struct {
		n   int
		err error
	}
	resultCh := make(chan readResult, 1)
	go func() {
		n, err := c.conn.Read(tmp)
		resultCh <- readResult{n: n, err: err}
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case result := <-resultCh:
		if result.n > 0 {
			c.buffer = append(c.buffer, tmp[:result.n]...)
		}
		return result.err
	}
}

func pumpUdp(ctx context.Context, transport *relayTransport, handle func([]byte) error) error {
	handlerErrCh := make(chan error, 1)
	reorder := newUdpRtpReorderBuffer(func(packet []byte) {
		if err := handle(packet); err != nil {
			select {
			case handlerErrCh <- err:
			default:
			}
		}
	})
	started := false
	stopRead := make(chan struct{})
	defer reorder.stop()
	go func() {
		select {
		case <-ctx.Done():
			_ = transport.rtpSocket.Close()
		case <-stopRead:
		}
	}()
	defer close(stopRead)
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		select {
		case err := <-handlerErrCh:
			return err
		default:
		}

		timeout := 15 * time.Second
		if started {
			timeout = 5 * time.Second
		}
		_ = transport.rtpSocket.SetReadDeadline(time.Now().Add(timeout))
		buffer := make([]byte, 2048)
		n, _, err := transport.rtpSocket.ReadFromUDP(buffer)
		if err != nil {
			select {
			case handlerErr := <-handlerErrCh:
				return handlerErr
			default:
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				if !started {
					return errors.New("rtsp relay timed out waiting for the first RTP packet")
				}
				reorder.close()
				return nil
			}
			return err
		}
		started = true
		reorder.push(buffer[:n])
		select {
		case err := <-handlerErrCh:
			return err
		default:
		}
	}
}

type mediaSection struct {
	payloadTypes []int
	control      string
	rtpmap       map[int]string
}

func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func resolveControlURL(control string, baseURL *url.URL) *url.URL {
	if control == "*" {
		copyURL := *baseURL
		return &copyURL
	}

	resolved, err := url.Parse(control)
	if err == nil && resolved.Scheme != "" {
		return resolved
	}

	derived := baseURL.ResolveReference(&url.URL{Path: control})
	if derived.RawQuery == "" && baseURL.RawQuery != "" {
		derived.RawQuery = baseURL.RawQuery
	}
	return derived
}

func parseTransportHeader(value string) string {
	return strings.ToLower(value)
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
