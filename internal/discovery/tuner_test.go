package discovery

import (
	"strings"
	"testing"
)

// ---- handleTunerRequest (unit tests) ----------------------------------------

func TestHandleTunerRequestSetGetAndReset(t *testing.T) {
	cases := []struct {
		field    string
		setValue string
		resetTo  string // expected value after setting empty string
	}{
		{"channel", "qam:111000000", "none"},
		{"target", "udp://192.168.1.10:5000", "none"},
		{"lockkey", "12345", "none"},
		{"channelmap", "us-cable", "us-bcast"},
		{"filter", "0x0100", "0x0000-0x1FFF"},
		{"program", "5", "0"},
	}
	for _, tc := range cases {
		t.Run(tc.field, func(t *testing.T) {
			state := createInitialTunerState()

			// set a value
			v := tc.setValue
			result := handleTunerRequest(&state, tc.field, &v)
			if result == nil || *result != tc.setValue {
				t.Fatalf("set %s: got %v, want %q", tc.field, result, tc.setValue)
			}

			// get returns the same value
			result = handleTunerRequest(&state, tc.field, nil)
			if result == nil || *result != tc.setValue {
				t.Fatalf("get %s: got %v, want %q", tc.field, result, tc.setValue)
			}

			// setting empty string resets to default
			empty := ""
			handleTunerRequest(&state, tc.field, &empty)
			result = handleTunerRequest(&state, tc.field, nil)
			if result == nil || *result != tc.resetTo {
				t.Fatalf("reset %s: got %v, want %q", tc.field, result, tc.resetTo)
			}
		})
	}
}

func TestHandleTunerRequestStatus(t *testing.T) {
	state := createInitialTunerState()

	// Default state: no channel → lock=none, ss=0
	result := handleTunerRequest(&state, "status", nil)
	if result == nil {
		t.Fatal("status returned nil")
	}
	if !strings.Contains(*result, "lock=none") || !strings.Contains(*result, "ss=0") {
		t.Errorf("default status = %q, want lock=none ss=0", *result)
	}

	// With active channel → lock=qam, ss=100
	v := "qam:111000000"
	handleTunerRequest(&state, "channel", &v)
	result = handleTunerRequest(&state, "status", nil)
	if result == nil {
		t.Fatal("status returned nil")
	}
	if !strings.Contains(*result, "ch=qam:111000000") || !strings.Contains(*result, "lock=qam") || !strings.Contains(*result, "ss=100") {
		t.Errorf("active status = %q, want ch= lock=qam ss=100", *result)
	}
}

func TestHandleTunerRequestUnknownFieldReturnsNil(t *testing.T) {
	state := createInitialTunerState()
	result := handleTunerRequest(&state, "nonexistent", nil)
	if result != nil {
		t.Fatalf("unknown field should return nil, got %q", *result)
	}
}

// ---- handleControlRequest tuner integration --------------------------------

func TestHandleControlRequestTunerGetChannel(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(2)

	reply := handleControlRequest(runtime, tuners, &controlRequest{name: "/tuner0/channel"})
	decoded := decodeGetSetReply(t, reply)
	if decoded.name != "/tuner0/channel" {
		t.Fatalf("name = %q", decoded.name)
	}
	if decoded.value != "none" {
		t.Fatalf("value = %q, want \"none\"", decoded.value)
	}
}

func TestHandleControlRequestTunerSetChannel(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(2)

	v := "qam:111000000"
	reply := handleControlRequest(runtime, tuners, &controlRequest{name: "/tuner0/channel", value: &v})
	decoded := decodeGetSetReply(t, reply)
	if decoded.value != "qam:111000000" {
		t.Fatalf("value = %q", decoded.value)
	}

	// Verify tuner 1 is independent
	reply1 := handleControlRequest(runtime, tuners, &controlRequest{name: "/tuner1/channel"})
	decoded1 := decodeGetSetReply(t, reply1)
	if decoded1.value != "none" {
		t.Fatalf("tuner1 should still be \"none\", got %q", decoded1.value)
	}
}

func TestHandleControlRequestTunerOutOfRange(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(2)

	reply := handleControlRequest(runtime, tuners, &controlRequest{name: "/tuner5/channel"})
	decoded := decodeGetSetReply(t, reply)
	if decoded.value != "" {
		t.Fatalf("out-of-range tuner should return error, got value %q", decoded.value)
	}
}

func TestHandleControlRequestTunerUnknownField(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(1)

	reply := handleControlRequest(runtime, tuners, &controlRequest{name: "/tuner0/bogus"})
	decoded := decodeGetSetReply(t, reply)
	if decoded.value != "" {
		t.Fatalf("unknown tuner field should return error, got value %q", decoded.value)
	}
}

func TestHandleControlRequestTunerNoSlash(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(1)

	reply := handleControlRequest(runtime, tuners, &controlRequest{name: "/tuner0"})
	decoded := decodeGetSetReply(t, reply)
	// /tuner0 without a trailing /field should be an error
	if decoded.value != "" {
		t.Fatalf("expected error for /tuner0 without field, got value %q", decoded.value)
	}
}

func TestHandleControlRequestTunerStatus(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(1)

	reply := handleControlRequest(runtime, tuners, &controlRequest{name: "/tuner0/status"})
	decoded := decodeGetSetReply(t, reply)
	if !strings.Contains(decoded.value, "lock=") {
		t.Fatalf("status value should contain lock=, got %q", decoded.value)
	}
}

func TestHandleControlRequestNilRequest(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(1)

	reply := handleControlRequest(runtime, tuners, nil)
	if reply != nil {
		t.Fatalf("nil request should return nil reply, got %d bytes", len(reply))
	}
}

func TestHandleControlRequestUnknownKey(t *testing.T) {
	runtime := Runtime{Config: testConfig(), Logger: testLogger{}}
	tuners := newTunerRegistry(1)

	reply := handleControlRequest(runtime, tuners, &controlRequest{name: "/unknown/key"})
	decoded := decodeGetSetReply(t, reply)
	if decoded.value != "" {
		t.Fatalf("unknown key should be error reply, got value %q", decoded.value)
	}
}

