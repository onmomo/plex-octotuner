package discovery

import (
	"encoding/binary"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"

	"plex-octotuner/internal/hdhr"
)

type ControlServerOptions struct {
	BindAddress string
	ControlPort int
}

type controlRequest struct {
	name  string
	value *string
}

type hdhomerunFrame struct {
	frameType   uint16
	payload     []byte
	totalLength int
	valid       bool
}

type tunerState struct {
	channel    string
	channelmap string
	filter     string
	lockkey    string
	program    string
	target     string
}

type tunerRegistry struct {
	mu     sync.Mutex
	tuners []tunerState
}

func buildFrame(frameType uint16, payload []byte) []byte {
	header := make([]byte, 4)
	binary.BigEndian.PutUint16(header[0:2], frameType)
	binary.BigEndian.PutUint16(header[2:4], uint16(len(payload)))

	packet := append(header, payload...)
	crc := crc32IEEE(packet)
	trailer := make([]byte, 4)
	binary.LittleEndian.PutUint32(trailer, crc)

	return append(packet, trailer...)
}

func tryReadFrame(buffer []byte) *hdhomerunFrame {
	if len(buffer) < 8 {
		return nil
	}

	payloadLength := int(readUint16BE(buffer, 2))
	totalLength := 4 + payloadLength + 4
	if len(buffer) < totalLength {
		return nil
	}

	packet := buffer[:totalLength-4]
	if crc32IEEE(packet) != readUint32LE(buffer, totalLength-4) {
		return &hdhomerunFrame{totalLength: totalLength, valid: false}
	}

	return &hdhomerunFrame{
		frameType:   readUint16BE(buffer, 0),
		payload:     append([]byte(nil), buffer[4:4+payloadLength]...),
		totalLength: totalLength,
		valid:       true,
	}
}

func decodeCString(value []byte) string {
	return strings.TrimRight(string(value), "\x00")
}

func parseGetSetRequest(payload []byte) *controlRequest {
	offset := 0
	var name *string
	var value *string

	for offset < len(payload) {
		tag := payload[offset]
		offset++

		length := readHdhomerunVarLength(payload, offset)
		if length == nil {
			return nil
		}
		offset += length.byteLength

		if offset+length.value > len(payload) {
			return nil
		}

		body := payload[offset : offset+length.value]
		offset += length.value
		text := decodeCString(body)

		switch tag {
		case hdhomerunTagGetSetName:
			name = &text
		case hdhomerunTagGetSetValue:
			value = &text
		}
	}

	if name == nil {
		return nil
	}

	return &controlRequest{name: *name, value: value}
}

func encodeCString(value string) []byte {
	out := make([]byte, len(value)+1)
	copy(out, value)
	return out
}

func buildGetSetReply(name, value string) []byte {
	payload := make([]byte, 0)
	payload = append(payload, encodeTag(hdhomerunTagGetSetName, encodeCString(name))...)
	payload = append(payload, encodeTag(hdhomerunTagGetSetValue, encodeCString(value))...)
	return buildFrame(hdhomerunTypeGetSetReply, payload)
}

func buildErrorReply(name, message string) []byte {
	payload := make([]byte, 0)
	payload = append(payload, encodeTag(hdhomerunTagGetSetName, encodeCString(name))...)
	payload = append(payload, encodeTag(hdhomerunTagErrorMessage, encodeCString(message))...)
	return buildFrame(hdhomerunTypeGetSetReply, payload)
}

func createInitialTunerState() tunerState {
	return tunerState{
		channel:    "none",
		channelmap: "us-bcast",
		filter:     "0x0000-0x1FFF",
		lockkey:    "none",
		program:    "0",
		target:     "none",
	}
}

func newTunerRegistry(count int) *tunerRegistry {
	tuners := make([]tunerState, count)
	for i := range tuners {
		tuners[i] = createInitialTunerState()
	}
	return &tunerRegistry{tuners: tuners}
}

func buildFeaturesValue() string {
	return strings.Join([]string{
		"channelmap: us-bcast us-cable",
		"modulation: auto",
		"auto-modulation: auto",
		"program: 0",
	}, "\n")
}

func buildTunerStatus(state tunerState) string {
	channel := state.channel
	lock := "qam"
	signal := 100
	if channel == "none" {
		lock = "none"
		signal = 0
	}

	return fmt.Sprintf("ch=%s lock=%s ss=%d snq=%d seq=%d bps=0 pps=0", channel, lock, signal, signal, signal)
}

func handleTunerRequest(state *tunerState, field string, value *string) *string {
	switch field {
	case "channel":
		if value != nil {
			if *value == "" {
				state.channel = "none"
			} else {
				state.channel = *value
			}
		}
		return &state.channel
	case "channelmap":
		if value != nil {
			if *value == "" {
				state.channelmap = "us-bcast"
			} else {
				state.channelmap = *value
			}
		}
		return &state.channelmap
	case "filter":
		if value != nil {
			if *value == "" {
				state.filter = "0x0000-0x1FFF"
			} else {
				state.filter = *value
			}
		}
		return &state.filter
	case "lockkey":
		if value != nil {
			if *value == "" {
				state.lockkey = "none"
			} else {
				state.lockkey = *value
			}
		}
		return &state.lockkey
	case "program":
		if value != nil {
			if *value == "" {
				state.program = "0"
			} else {
				state.program = *value
			}
		}
		return &state.program
	case "status":
		status := buildTunerStatus(*state)
		return &status
	case "streaminfo":
		value := "none"
		return &value
	case "target":
		if value != nil {
			if *value == "" {
				state.target = "none"
			} else {
				state.target = *value
			}
		}
		return &state.target
	default:
		return nil
	}
}

func handleControlRequest(runtime Runtime, tuners *tunerRegistry, request *controlRequest) []byte {
	if request == nil {
		return nil
	}

	if strings.HasPrefix(request.name, "/tuner") {
		rest := strings.TrimPrefix(request.name, "/tuner")
		slash := strings.IndexByte(rest, '/')
		if slash <= 0 {
			return buildErrorReply(request.name, "ERROR: unknown key")
		}

		indexText := rest[:slash]
		field := rest[slash+1:]
		if !isDecimal(indexText) {
			return buildErrorReply(request.name, "ERROR: unknown key")
		}
		index, err := strconv.Atoi(indexText)
		if err != nil {
			return buildErrorReply(request.name, "ERROR: unknown key")
		}

		tuners.mu.Lock()
		defer tuners.mu.Unlock()
		if index < 0 || index >= len(tuners.tuners) {
			return buildErrorReply(request.name, "ERROR: unknown key")
		}

		value := handleTunerRequest(&tuners.tuners[index], field, request.value)
		if value == nil {
			return buildErrorReply(request.name, "ERROR: unknown key")
		}

		return buildGetSetReply(request.name, *value)
	}

	switch request.name {
	case "/help":
		return buildGetSetReply(request.name, "help")
	case "/lineup/location":
		return buildGetSetReply(request.name, advertisedOrigin(runtime.Config)+"/lineup.json")
	case "/sys/copyright":
		return buildGetSetReply(request.name, "Copyright Silicondust")
	case "/sys/debug":
		return buildGetSetReply(request.name, "0")
	case "/sys/features":
		return buildGetSetReply(request.name, buildFeaturesValue())
	case "/sys/hwmodel", "/sys/model":
		return buildGetSetReply(request.name, hdhr.ModelNumber)
	case "/sys/version":
		return buildGetSetReply(request.name, hdhr.FirmwareVersion)
	default:
		return buildErrorReply(request.name, "ERROR: unknown key")
	}
}

func StartHdhomerunControlServer(runtime Runtime, opts ControlServerOptions) (Handle, error) {
	port := opts.ControlPort
	if port == 0 {
		port = hdhomerunControlTCPPort
	}

	addr := &net.TCPAddr{Port: port}
	if opts.BindAddress != "" {
		ip := net.ParseIP(opts.BindAddress)
		if ip == nil {
			return nil, fmt.Errorf("invalid bind address %q", opts.BindAddress)
		}
		addr.IP = ip
	}

	listener, err := net.ListenTCP("tcp4", addr)
	if err != nil {
		return nil, err
	}

	tuners := newTunerRegistry(runtime.Config.TunerCount)
	activeConnections := map[net.Conn]struct{}{}
	var activeConnectionsMu sync.Mutex

	var once sync.Once
	stop := func() error {
		var closeErr error
		once.Do(func() {
			closeErr = listener.Close()
			activeConnectionsMu.Lock()
			defer activeConnectionsMu.Unlock()
			for conn := range activeConnections {
				if err := conn.Close(); err != nil && closeErr == nil {
					closeErr = err
				}
			}
		})
		return closeErr
	}

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			activeConnectionsMu.Lock()
			activeConnections[conn] = struct{}{}
			activeConnectionsMu.Unlock()
			go handleControlConnection(runtime, conn, tuners, func() {
				activeConnectionsMu.Lock()
				delete(activeConnections, conn)
				activeConnectionsMu.Unlock()
			})
		}
	}()

	return newStopHandle(stop), nil
}

func handleControlConnection(runtime Runtime, conn net.Conn, tuners *tunerRegistry, onClose func()) {
	defer conn.Close()
	defer onClose()

	buffer := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)

	for {
		n, err := conn.Read(tmp)
		if err != nil {
			return
		}
		buffer = append(buffer, tmp[:n]...)

		for len(buffer) > 0 {
			frame := tryReadFrame(buffer)
			if frame == nil {
				break
			}
			buffer = buffer[frame.totalLength:]
			if !frame.valid || frame.frameType != hdhomerunTypeGetSetRequest {
				continue
			}

			request := parseGetSetRequest(frame.payload)
			if request == nil {
				continue
			}

			reply := handleControlRequest(runtime, tuners, request)
			if _, err := conn.Write(reply); err != nil {
				return
			}
		}
	}
}

func isDecimal(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}
