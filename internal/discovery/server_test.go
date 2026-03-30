package discovery

import (
	"net"
	"testing"
	"time"

	"plex-octotuner/internal/config"
)

func TestDiscoveryServerHandlesLiveUdpRequests(t *testing.T) {
	cfg := testConfig()
	udpPort := reserveUDPPort(t)
	ssdpPort := reserveUDPPort(t)

	runtime := Runtime{
		Config: cfg,
		Logger: testLogger{},
	}

	server, err := StartDiscoveryServer(runtime, DiscoveryServerOptions{
		BindAddress:       "127.0.0.1",
		SSDPPort:          ssdpPort,
		HDHomerunPort:     udpPort,
		JoinSSDPMulticast: boolPtr(false),
		StartControl:      boolPtr(false),
		StartupNotify:     boolPtr(false),
	})
	if err != nil {
		t.Fatalf("start discovery server: %v", err)
	}
	defer func() {
		if err := server.Stop(); err != nil {
			t.Fatalf("stop discovery server: %v", err)
		}
	}()

	ssdpClient := mustListenUDP(t)
	defer ssdpClient.Close()
	ssdpReply := awaitUDPMessage(t, ssdpClient)

	sendUDP(t, ssdpClient, []byte("M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\n\r\n"), ssdpPort)

	message, remote := awaitUDPReply(t, ssdpReply)
	if remote.Port != ssdpPort {
		t.Fatalf("ssdp reply port = %d, want %d", remote.Port, ssdpPort)
	}
	if got := string(message); !containsLine(got, "ST: upnp:rootdevice") {
		t.Fatalf("ssdp reply missing ST header: %q", got)
	}

	hdhomerunClient := mustListenUDP(t)
	defer hdhomerunClient.Close()
	hdhrReply := awaitUDPMessage(t, hdhomerunClient)

	sendUDP(t, hdhomerunClient, buildDiscoveryRequest([]uint32{hdhomerunDeviceTypeTuner}, 0xFFFFFFFF), udpPort)
	message, remote = awaitUDPReply(t, hdhrReply)
	if remote.Port != udpPort {
		t.Fatalf("hdhomerun reply port = %d, want %d", remote.Port, udpPort)
	}
	if string(message) != string(buildHdhomerunDiscoveryReply(cfg)) {
		t.Fatal("unexpected discovery reply payload")
	}
}

func TestDiscoveryServerFailsFastWhenMulticastInterfaceCannotBeResolved(t *testing.T) {
	cfg := config.Config{
		AdvertisedBaseURL: mustParseURL(t, "http://198.51.100.10:34400"),
		DeviceID:          "105A1B22",
		DeviceAuth:        "octotuner-105A1B22",
		TunerCount:        4,
	}

	_, err := StartDiscoveryServer(Runtime{Config: cfg, Logger: testLogger{}}, DiscoveryServerOptions{
		JoinSSDPMulticast: boolPtr(true),
		StartControl:      boolPtr(false),
		StartupNotify:     boolPtr(false),
	})
	if err == nil {
		t.Fatal("expected start to fail when multicast interface cannot be resolved")
	}
}

func TestDiscoveryServerFailsFastWhenAdvertisedHostIsNotIPv4(t *testing.T) {
	cfg := config.Config{
		AdvertisedBaseURL: mustParseURL(t, "http://octotuner.local:34400"),
		DeviceID:          "105A1B22",
		DeviceAuth:        "octotuner-105A1B22",
		TunerCount:        4,
	}

	_, err := StartDiscoveryServer(Runtime{Config: cfg, Logger: testLogger{}}, DiscoveryServerOptions{
		JoinSSDPMulticast: boolPtr(true),
		StartControl:      boolPtr(false),
		StartupNotify:     boolPtr(false),
	})
	if err == nil {
		t.Fatal("expected start to fail when advertised host is not IPv4")
	}
}

func TestDiscoveryServerRejectsInvalidUDPBindAddress(t *testing.T) {
	_, err := StartDiscoveryServer(Runtime{Config: testConfig(), Logger: testLogger{}}, DiscoveryServerOptions{
		BindAddress:       "not-an-ip",
		JoinSSDPMulticast: boolPtr(false),
		StartControl:      boolPtr(false),
		StartupNotify:     boolPtr(false),
	})
	if err == nil {
		t.Fatal("expected start to fail for invalid UDP bind address")
	}
}

func TestApplyDiscoveryDefaultsEnablesValidatedRuntimeBehavior(t *testing.T) {
	options := applyDiscoveryDefaults(DiscoveryServerOptions{})

	if options.JoinSSDPMulticast == nil || !*options.JoinSSDPMulticast {
		t.Fatal("expected SSDP multicast joins to default on")
	}
	if options.StartControl == nil || !*options.StartControl {
		t.Fatal("expected HDHomeRun control server to default on")
	}
	if options.StartupNotify == nil || !*options.StartupNotify {
		t.Fatal("expected startup SSDP notify to default on")
	}
	if options.SSDPMulticastHost != ssdpMulticastHost {
		t.Fatalf("multicast host = %q, want %q", options.SSDPMulticastHost, ssdpMulticastHost)
	}
	if options.SSDPPort != ssdpMulticastPort {
		t.Fatalf("ssdp port = %d, want %d", options.SSDPPort, ssdpMulticastPort)
	}
	if options.HDHomerunPort != hdhomerunDiscoveryPort {
		t.Fatalf("hdhomerun port = %d, want %d", options.HDHomerunPort, hdhomerunDiscoveryPort)
	}
	if options.ControlPort != hdhomerunControlTCPPort {
		t.Fatalf("control port = %d, want %d", options.ControlPort, hdhomerunControlTCPPort)
	}
}

func TestControlServerHandlesLiveTcpRequests(t *testing.T) {
	port := reserveTCPPort(t)
	runtime := Runtime{
		Config: testConfig(),
		Logger: testLogger{},
	}

	server, err := StartHdhomerunControlServer(runtime, ControlServerOptions{
		BindAddress: "127.0.0.1",
		ControlPort: port,
	})
	if err != nil {
		t.Fatalf("start control server: %v", err)
	}
	defer func() {
		if err := server.Stop(); err != nil {
			t.Fatalf("stop control server: %v", err)
		}
	}()

	reply := tcpGetSet(t, port, "/sys/model")
	decoded := decodeGetSetReply(t, reply)
	if decoded.frameType != hdhomerunTypeGetSetReply {
		t.Fatalf("frame type = %#x, want %#x", decoded.frameType, hdhomerunTypeGetSetReply)
	}
	if decoded.name != "/sys/model" {
		t.Fatalf("name = %q, want %q", decoded.name, "/sys/model")
	}
	if decoded.value != "HDTC-2US" {
		t.Fatalf("value = %q, want %q", decoded.value, "HDTC-2US")
	}

	reply = tcpGetSet(t, port, "/tuner0/channel")
	decoded = decodeGetSetReply(t, reply)
	if decoded.value != "none" {
		t.Fatalf("tuner channel = %q, want %q", decoded.value, "none")
	}
}

func TestControlServerStopClosesAcceptedConnections(t *testing.T) {
	port := reserveTCPPort(t)
	runtime := Runtime{
		Config: testConfig(),
		Logger: testLogger{},
	}

	server, err := StartHdhomerunControlServer(runtime, ControlServerOptions{
		BindAddress: "127.0.0.1",
		ControlPort: port,
	})
	if err != nil {
		t.Fatalf("start control server: %v", err)
	}

	conn, err := net.DialTimeout("tcp4", net.JoinHostPort("127.0.0.1", itoa(port)), 2*time.Second)
	if err != nil {
		t.Fatalf("dial tcp: %v", err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := conn.Write(buildGetSetRequest("/sys/model")); err != nil {
		t.Fatalf("prime connection: %v", err)
	}
	reply := make([]byte, 256)
	if _, err := conn.Read(reply); err != nil {
		t.Fatalf("prime read: %v", err)
	}

	if err := server.Stop(); err != nil {
		t.Fatalf("stop control server: %v", err)
	}

	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	_, writeErr := conn.Write(buildGetSetRequest("/sys/model"))
	if writeErr == nil {
		reply := make([]byte, 64)
		_, readErr := conn.Read(reply)
		if readErr == nil {
			t.Fatal("expected accepted connection to be closed after stop")
		}
	}
}

type testLogger struct{}

func (testLogger) Info(string, any)  {}
func (testLogger) Error(string, any) {}
func (testLogger) Warn(string, any)  {}

func mustListenUDP(t *testing.T) *net.UDPConn {
	t.Helper()
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
	if err != nil {
		t.Fatalf("listen udp: %v", err)
	}
	return conn
}

func reserveUDPPort(t *testing.T) int {
	t.Helper()
	conn := mustListenUDP(t)
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).Port
}

func reserveTCPPort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen tcp: %v", err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func awaitUDPMessage(t *testing.T, conn *net.UDPConn) <-chan struct {
	message []byte
	remote  *net.UDPAddr
} {
	t.Helper()
	ch := make(chan struct {
		message []byte
		remote  *net.UDPAddr
	}, 1)
	go func() {
		buf := make([]byte, 4096)
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		n, remote, err := conn.ReadFromUDP(buf)
		if err != nil {
			t.Errorf("read udp: %v", err)
			return
		}
		ch <- struct {
			message []byte
			remote  *net.UDPAddr
		}{message: append([]byte(nil), buf[:n]...), remote: remote}
	}()
	return ch
}

func awaitUDPReply(t *testing.T, ch <-chan struct {
	message []byte
	remote  *net.UDPAddr
}) ([]byte, *net.UDPAddr) {
	t.Helper()
	select {
	case result := <-ch:
		return result.message, result.remote
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for UDP reply")
		return nil, nil
	}
}

func sendUDP(t *testing.T, conn *net.UDPConn, message []byte, port int) {
	t.Helper()
	if _, err := conn.WriteToUDP(message, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port}); err != nil {
		t.Fatalf("send udp: %v", err)
	}
}
