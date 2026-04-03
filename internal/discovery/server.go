package discovery

import (
	"fmt"
	"net"
	"strings"
	"sync"
)

type DiscoveryServerOptions struct {
	BindAddress       string
	ControlPort       int
	SSDPPort          int
	HDHomerunPort     int
	SSDPMulticastHost string
	JoinSSDPMulticast *bool
	StartControl      *bool
	StartupNotify     *bool
}

type udpSender interface {
	WriteTo([]byte, *net.UDPAddr) (int, error)
	Close() error
}

func applyDiscoveryDefaults(opts DiscoveryServerOptions) DiscoveryServerOptions {
	if opts.SSDPPort == 0 {
		opts.SSDPPort = ssdpMulticastPort
	}
	if opts.HDHomerunPort == 0 {
		opts.HDHomerunPort = hdhomerunDiscoveryPort
	}
	if opts.ControlPort == 0 {
		opts.ControlPort = hdhomerunControlTCPPort
	}
	if opts.SSDPMulticastHost == "" {
		opts.SSDPMulticastHost = ssdpMulticastHost
	}
	if opts.JoinSSDPMulticast == nil {
		opts.JoinSSDPMulticast = boolPtr(true)
	}
	if opts.StartControl == nil {
		opts.StartControl = boolPtr(true)
	}
	if opts.StartupNotify == nil {
		opts.StartupNotify = boolPtr(true)
	}
	return opts
}

func sendStartupNotify(cfg Runtime, host string, send func([]byte, string, int) error) error {
	for _, packet := range buildSsdpNotifyPackets(cfg.Config) {
		if err := send([]byte(packet), host, ssdpMulticastPort); err != nil {
			return err
		}
	}
	return nil
}

func handleSsdpMessage(cfg Runtime, message []byte, remoteAddress string, remotePort int, send func([]byte, string, int) error) (bool, error) {
	searchTarget := parseSsdpSearchTarget(message)
	if searchTarget == "" {
		return false, nil
	}

	for _, response := range buildSsdpSearchResponses(cfg.Config, searchTarget) {
		if err := send([]byte(response), remoteAddress, remotePort); err != nil {
			return true, err
		}
	}

	return true, nil
}

func handleHdhomerunDiscoveryRequest(runtime Runtime, message []byte, remoteAddress string, remotePort int, send func([]byte, string, int) error) (bool, error) {
	request, ok := parseHdhomerunDiscoveryRequest(message)
	if !ok {
		return false, nil
	}

	if !requestMatchesConfig(*request, runtime.Config) {
		return false, nil
	}

	return true, send(buildHdhomerunDiscoveryReply(runtime.Config), remoteAddress, remotePort)
}

func parseSsdpSearchTarget(message []byte) string {
	lines := strings.Split(string(message), "\r\n")
	if len(lines) == 0 || strings.ToUpper(strings.TrimSpace(lines[0])) != "M-SEARCH * HTTP/1.1" {
		return ""
	}

	for _, line := range lines[1:] {
		if line == "" {
			continue
		}
		colon := strings.IndexByte(line, ':')
		if colon <= 0 {
			continue
		}
		key := strings.TrimSpace(strings.ToLower(line[:colon]))
		if key == "st" {
			return strings.TrimSpace(line[colon+1:])
		}
	}

	return ""
}

func resolveSsdpMulticastInterface(cfg Runtime, opts DiscoveryServerOptions) (*net.Interface, error) {
	candidate := opts.BindAddress
	if candidate == "" {
		candidate = cfg.Config.AdvertisedBaseURL.Hostname()
	}

	ip := net.ParseIP(candidate)
	if ip == nil {
		return nil, fmt.Errorf("ssdp multicast interface must be an IPv4 address: %s", candidate)
	}

	ip = ip.To4()
	if ip == nil {
		return nil, fmt.Errorf("ssdp multicast interface must be IPv4: %s", candidate)
	}

	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}

	for _, iface := range ifaces {
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			if ipnet.IP.To4() != nil && ipnet.IP.To4().Equal(ip) {
				ifaceCopy := iface
				return &ifaceCopy, nil
			}
		}
	}

	return nil, fmt.Errorf("ssdp multicast join failed on interface %s: not found", candidate)
}

func listenUDP(network string, addr *net.UDPAddr) (*net.UDPConn, error) {
	return net.ListenUDP(network, addr)
}

func parseBindIP(bindAddress string) (net.IP, error) {
	if bindAddress == "" {
		return nil, nil
	}

	ip := net.ParseIP(bindAddress)
	if ip == nil {
		return nil, fmt.Errorf("invalid bind address %q", bindAddress)
	}

	return ip, nil
}

func StartDiscoveryServer(runtime Runtime, opts DiscoveryServerOptions) (Handle, error) {
	opts = applyDiscoveryDefaults(opts)
	ssdpPort := opts.SSDPPort
	hdhomerunPort := opts.HDHomerunPort
	ssdpGroupHost := opts.SSDPMulticastHost
	bindIP, err := parseBindIP(opts.BindAddress)
	if err != nil {
		return nil, err
	}

	var ssdpConn *net.UDPConn
	if *opts.JoinSSDPMulticast {
		ifi, joinErr := resolveSsdpMulticastInterface(runtime, opts)
		if joinErr != nil {
			return nil, joinErr
		}
		ssdpConn, err = net.ListenMulticastUDP("udp4", ifi, &net.UDPAddr{IP: net.ParseIP(ssdpGroupHost), Port: ssdpPort})
	} else {
		ssdpAddr := &net.UDPAddr{Port: ssdpPort}
		if bindIP != nil {
			ssdpAddr.IP = bindIP
		}
		ssdpConn, err = listenUDP("udp4", ssdpAddr)
	}
	if err != nil {
		return nil, err
	}

	hdhomerunAddr := &net.UDPAddr{Port: hdhomerunPort}
	if bindIP != nil {
		hdhomerunAddr.IP = bindIP
	}
	hdhomerunConn, err := listenUDP("udp4", hdhomerunAddr)
	if err != nil {
		_ = ssdpConn.Close()
		return nil, err
	}

	controlHandle := Handle(nil)
	if *opts.StartControl {
		controlHandle, err = StartHdhomerunControlServer(runtime, ControlServerOptions{
			BindAddress: opts.BindAddress,
			ControlPort: opts.ControlPort,
		})
		if err != nil {
			_ = hdhomerunConn.Close()
			_ = ssdpConn.Close()
			return nil, err
		}
	}

	var once sync.Once
	stop := func() error {
		var closeErr error
		once.Do(func() {
			if controlHandle != nil {
				if err := controlHandle.Stop(); err != nil && closeErr == nil {
					closeErr = err
				}
			}
			if err := hdhomerunConn.Close(); err != nil && closeErr == nil {
				closeErr = err
			}
			if err := ssdpConn.Close(); err != nil && closeErr == nil {
				closeErr = err
			}
		})
		return closeErr
	}

	go func() {
		buf := make([]byte, 4096)
		for {
			n, remote, err := ssdpConn.ReadFromUDP(buf)
			if err != nil {
				return
			}
			message := append([]byte(nil), buf[:n]...)
			_, _ = handleSsdpMessage(runtime, message, remote.IP.String(), remote.Port, func(reply []byte, address string, port int) error {
				_, err := ssdpConn.WriteToUDP(reply, &net.UDPAddr{IP: net.ParseIP(address), Port: port})
				return err
			})
		}
	}()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, remote, err := hdhomerunConn.ReadFromUDP(buf)
			if err != nil {
				return
			}
			message := append([]byte(nil), buf[:n]...)
			_, _ = handleHdhomerunDiscoveryRequest(runtime, message, remote.IP.String(), remote.Port, func(reply []byte, address string, port int) error {
				_, err := hdhomerunConn.WriteToUDP(reply, &net.UDPAddr{IP: net.ParseIP(address), Port: port})
				return err
			})
		}
	}()

	if *opts.StartupNotify {
		if err := sendStartupNotify(runtime, ssdpGroupHost, func(message []byte, address string, port int) error {
			_, err := ssdpConn.WriteToUDP(message, &net.UDPAddr{IP: net.ParseIP(address), Port: port})
			return err
		}); err != nil {
			_ = stop()
			return nil, err
		}
	}

	return newStopHandle(stop), nil
}

func boolPtr(value bool) *bool {
	return &value
}
