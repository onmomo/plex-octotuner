package discovery

import (
	"strings"
	"testing"
)

// ---- handleTunerRequest (unit tests) ----------------------------------------

func TestHandleTunerRequestGetChannel(t *testing.T) {
	state := createInitialTunerState()
	result := handleTunerRequest(&state, "channel", nil)
	if result == nil || *result != "none" {
		t.Fatalf("get channel = %v, want \"none\"", result)
	}
}

func TestHandleTunerRequestSetChannel(t *testing.T) {
	state := createInitialTunerState()
	v := "qam:111000000"
	result := handleTunerRequest(&state, "channel", &v)
	if result == nil || *result != "qam:111000000" {
		t.Fatalf("set channel = %v", result)
	}
	if state.channel != "qam:111000000" {
		t.Fatalf("state.channel = %q", state.channel)
	}
}

func TestHandleTunerRequestSetEmptyChannelResetsToNone(t *testing.T) {
	state := createInitialTunerState()
	v := "qam:111000000"
	handleTunerRequest(&state, "channel", &v)
	empty := ""
	handleTunerRequest(&state, "channel", &empty)
	if state.channel != "none" {
		t.Fatalf("empty set should reset to \"none\", got %q", state.channel)
	}
}

func TestHandleTunerRequestSetAndGetTarget(t *testing.T) {
	state := createInitialTunerState()
	v := "udp://192.168.1.10:5000"
	handleTunerRequest(&state, "target", &v)
	result := handleTunerRequest(&state, "target", nil)
	if result == nil || *result != "udp://192.168.1.10:5000" {
		t.Fatalf("target = %v", result)
	}
}

func TestHandleTunerRequestSetEmptyTargetResetsToNone(t *testing.T) {
	state := createInitialTunerState()
	v := "udp://192.168.1.10:5000"
	handleTunerRequest(&state, "target", &v)
	empty := ""
	handleTunerRequest(&state, "target", &empty)
	if state.target != "none" {
		t.Fatalf("empty target should reset to \"none\", got %q", state.target)
	}
}

func TestHandleTunerRequestSetAndGetLockkey(t *testing.T) {
	state := createInitialTunerState()
	v := "12345"
	handleTunerRequest(&state, "lockkey", &v)
	result := handleTunerRequest(&state, "lockkey", nil)
	if result == nil || *result != "12345" {
		t.Fatalf("lockkey = %v", result)
	}
}

func TestHandleTunerRequestSetEmptyLockkeyResetsToNone(t *testing.T) {
	state := createInitialTunerState()
	v := "12345"
	handleTunerRequest(&state, "lockkey", &v)
	empty := ""
	handleTunerRequest(&state, "lockkey", &empty)
	if state.lockkey != "none" {
		t.Fatalf("empty lockkey should reset to \"none\", got %q", state.lockkey)
	}
}

func TestHandleTunerRequestSetAndGetChannelmap(t *testing.T) {
	state := createInitialTunerState()
	v := "us-cable"
	handleTunerRequest(&state, "channelmap", &v)
	if state.channelmap != "us-cable" {
		t.Fatalf("channelmap = %q", state.channelmap)
	}
}

func TestHandleTunerRequestSetEmptyChannelmapResetsDefault(t *testing.T) {
	state := createInitialTunerState()
	v := "us-cable"
	handleTunerRequest(&state, "channelmap", &v)
	empty := ""
	handleTunerRequest(&state, "channelmap", &empty)
	if state.channelmap != "us-bcast" {
		t.Fatalf("empty channelmap should reset to \"us-bcast\", got %q", state.channelmap)
	}
}

func TestHandleTunerRequestSetAndGetFilter(t *testing.T) {
	state := createInitialTunerState()
	v := "0x0100"
	handleTunerRequest(&state, "filter", &v)
	if state.filter != "0x0100" {
		t.Fatalf("filter = %q", state.filter)
	}
}

func TestHandleTunerRequestSetEmptyFilterResetsDefault(t *testing.T) {
	state := createInitialTunerState()
	v := "0x0100"
	handleTunerRequest(&state, "filter", &v)
	empty := ""
	handleTunerRequest(&state, "filter", &empty)
	if state.filter != "0x0000-0x1FFF" {
		t.Fatalf("empty filter should reset, got %q", state.filter)
	}
}

func TestHandleTunerRequestSetAndGetProgram(t *testing.T) {
	state := createInitialTunerState()
	v := "5"
	handleTunerRequest(&state, "program", &v)
	if state.program != "5" {
		t.Fatalf("program = %q", state.program)
	}
}

func TestHandleTunerRequestSetEmptyProgramResetsToZero(t *testing.T) {
	state := createInitialTunerState()
	v := "5"
	handleTunerRequest(&state, "program", &v)
	empty := ""
	handleTunerRequest(&state, "program", &empty)
	if state.program != "0" {
		t.Fatalf("empty program should reset to \"0\", got %q", state.program)
	}
}

func TestHandleTunerRequestGetStatus(t *testing.T) {
	state := createInitialTunerState()
	result := handleTunerRequest(&state, "status", nil)
	if result == nil {
		t.Fatal("status returned nil")
	}
	// Default state has channel=none → lock=none signal=0
	if !strings.Contains(*result, "lock=none") {
		t.Errorf("default status should show lock=none, got %q", *result)
	}
	if !strings.Contains(*result, "ss=0") {
		t.Errorf("default status should show ss=0, got %q", *result)
	}
}

func TestHandleTunerRequestGetStatusWithActiveChannel(t *testing.T) {
	state := createInitialTunerState()
	v := "qam:111000000"
	handleTunerRequest(&state, "channel", &v)

	result := handleTunerRequest(&state, "status", nil)
	if result == nil {
		t.Fatal("status returned nil")
	}
	if !strings.Contains(*result, "ch=qam:111000000") {
		t.Errorf("status should include channel, got %q", *result)
	}
	if !strings.Contains(*result, "lock=qam") {
		t.Errorf("active channel should show lock=qam, got %q", *result)
	}
	if !strings.Contains(*result, "ss=100") {
		t.Errorf("active channel should show ss=100, got %q", *result)
	}
}

func TestHandleTunerRequestGetStreaminfo(t *testing.T) {
	state := createInitialTunerState()
	result := handleTunerRequest(&state, "streaminfo", nil)
	if result == nil || *result != "none" {
		t.Fatalf("streaminfo = %v, want \"none\"", result)
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

// ---- buildTunerStatus ------------------------------------------------------

func TestBuildTunerStatusActiveChannel(t *testing.T) {
	state := tunerState{channel: "qam:111000000"}
	result := buildTunerStatus(state)
	if !strings.Contains(result, "ch=qam:111000000") {
		t.Errorf("missing channel, got %q", result)
	}
	if !strings.Contains(result, "lock=qam") {
		t.Errorf("missing lock=qam, got %q", result)
	}
	if !strings.Contains(result, "ss=100") {
		t.Errorf("missing ss=100, got %q", result)
	}
}

func TestBuildTunerStatusNoChannel(t *testing.T) {
	state := tunerState{channel: "none"}
	result := buildTunerStatus(state)
	if !strings.Contains(result, "lock=none") {
		t.Errorf("should have lock=none, got %q", result)
	}
	if !strings.Contains(result, "ss=0") {
		t.Errorf("should have ss=0, got %q", result)
	}
}
