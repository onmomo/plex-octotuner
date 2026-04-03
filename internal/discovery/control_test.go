package discovery

import (
	"bytes"
	"encoding/binary"
	"net"
	"strconv"
	"sync"
	"testing"
	"time"
)

type decodedGetSetReply struct {
	frameType uint16
	name      string
	value     string
}

func buildDiscoveryRequest(deviceTypes []uint32, deviceID uint32) []byte {
	payload := make([]byte, 0)
	if len(deviceTypes) == 1 {
		payload = append(payload, encodeTagTest(hdhomerunTagDeviceType, u32be(deviceTypes[0]))...)
	} else {
		body := make([]byte, 0, 4*len(deviceTypes))
		for _, deviceType := range deviceTypes {
			body = append(body, u32be(deviceType)...)
		}
		payload = append(payload, encodeTagTest(hdhomerunTagMultiType, body)...)
	}
	payload = append(payload, encodeTagTest(hdhomerunTagDeviceID, u32be(deviceID))...)

	frame := make([]byte, 4)
	binary.BigEndian.PutUint16(frame[0:2], hdhomerunTypeDiscoverRequest)
	binary.BigEndian.PutUint16(frame[2:4], uint16(len(payload)))
	packet := append(frame, payload...)
	crc := make([]byte, 4)
	binary.LittleEndian.PutUint32(crc, crc32IEEE(packet))
	return append(packet, crc...)
}

func decodeGetSetReply(t *testing.T, packet []byte) decodedGetSetReply {
	t.Helper()

	if len(packet) < 8 {
		t.Fatalf("short packet: %d", len(packet))
	}

	reply := decodedGetSetReply{frameType: binary.BigEndian.Uint16(packet[0:2])}
	payloadLength := int(binary.BigEndian.Uint16(packet[2:4]))
	payload := packet[4 : 4+payloadLength]
	offset := 0
	for offset < len(payload) {
		tag := payload[offset]
		offset++
		length := readHdhomerunVarLength(payload, offset)
		if length == nil {
			t.Fatalf("failed to read length at offset %d", offset)
		}
		offset += length.byteLength
		body := payload[offset : offset+length.value]
		offset += length.value
		text := bytes.TrimRight(body, "\x00")
		switch tag {
		case hdhomerunTagGetSetName:
			reply.name = string(text)
		case hdhomerunTagGetSetValue:
			reply.value = string(text)
		}
	}

	return reply
}

func tcpGetSet(t *testing.T, port int, name string) []byte {
	t.Helper()

	conn, err := net.DialTimeout("tcp4", net.JoinHostPort("127.0.0.1", itoa(port)), 2*time.Second)
	if err != nil {
		t.Fatalf("dial tcp: %v", err)
	}
	defer conn.Close()

	if _, err := conn.Write(buildGetSetRequest(name)); err != nil {
		t.Fatalf("write request: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatalf("read reply: %v", err)
	}
	return append([]byte(nil), buf[:n]...)
}

func TestHandleControlRequestMetadata(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(1)

	cases := []struct {
		name     string
		request  controlRequest
		expected string
		contains []string
	}{
		{name: "/help", request: controlRequest{name: "/help"}, expected: "help"},
		{name: "/lineup/location", request: controlRequest{name: "/lineup/location"}, expected: runtime.Config.AdvertisedBaseURL.String() + "/lineup.json"},
		{name: "/sys/features", request: controlRequest{name: "/sys/features"}, contains: []string{"channelmap: us-bcast us-cable", "program: 0"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reply := handleControlRequest(runtime, tuners, &tc.request)
			decoded := decodeGetSetReply(t, reply)
			if decoded.name != tc.request.name {
				t.Fatalf("name = %q, want %q", decoded.name, tc.request.name)
			}
			if tc.expected != "" && decoded.value != tc.expected {
				t.Fatalf("value = %q, want %q", decoded.value, tc.expected)
			}
			for _, fragment := range tc.contains {
				if !bytes.Contains([]byte(decoded.value), []byte(fragment)) {
					t.Fatalf("value %q does not contain %q", decoded.value, fragment)
				}
			}
		})
	}
}

func TestHandleControlRequestRejectsMalformedTunerPath(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(1)

	reply := handleControlRequest(runtime, tuners, &controlRequest{name: "/tuner0abc/channel"})
	decoded := decodeGetSetReply(t, reply)
	if decoded.name != "/tuner0abc/channel" {
		t.Fatalf("name = %q, want %q", decoded.name, "/tuner0abc/channel")
	}
	if decoded.value != "" {
		t.Fatalf("value = %q, want empty value for error reply", decoded.value)
	}
}

func TestHandleControlRequestIsSafeForConcurrentTunerMutations(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(runtime.Config.TunerCount)
	valueA := "qam:111000000"
	valueB := "qam:222000000"

	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			_ = handleControlRequest(runtime, tuners, &controlRequest{name: "/tuner0/channel", value: &valueA})
		}()
		go func() {
			defer wg.Done()
			_ = handleControlRequest(runtime, tuners, &controlRequest{name: "/tuner0/channel", value: &valueB})
		}()
	}
	wg.Wait()
}

func buildGetSetRequest(name string) []byte {
	payload := encodeTag(hdhomerunTagGetSetName, append([]byte(name), 0x00))
	frame := make([]byte, 4)
	binary.BigEndian.PutUint16(frame[0:2], hdhomerunTypeGetSetRequest)
	binary.BigEndian.PutUint16(frame[2:4], uint16(len(payload)))
	packet := append(frame, payload...)
	crc := make([]byte, 4)
	binary.LittleEndian.PutUint32(crc, crc32IEEE(packet))
	return append(packet, crc...)
}

func encodeTagTest(tag byte, value []byte) []byte {
	out := []byte{tag}
	out = append(out, encodeHdhomerunVarLength(len(value))...)
	out = append(out, value...)
	return out
}

func u32be(value uint32) []byte {
	buf := make([]byte, 4)
	binary.BigEndian.PutUint32(buf, value)
	return buf
}

func itoa(value int) string {
	return strconv.Itoa(value)
}
