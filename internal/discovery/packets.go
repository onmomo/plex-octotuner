package discovery

import (
	"encoding/hex"
	"fmt"
	"strings"

	"plex-octotuner/internal/config"
	"plex-octotuner/internal/hdhr"
)

const (
	ssdpMulticastHost       = "239.255.255.250"
	ssdpMulticastPort       = 1900
	ssdpRootDeviceTarget    = "upnp:rootdevice"
	ssdpAllTarget           = "ssdp:all"
	ssdpCacheMaxAgeSeconds  = 1800
	ssdpServerHeader        = "xTeVe"
	hdhomerunDiscoveryPort  = 65001
	hdhomerunControlTCPPort = 65001
)

type hdhomerunDiscoveryRequest struct {
	deviceID    *uint32
	deviceTypes []uint32
}

func buildSsdpLocation(cfg config.Config) string {
	return advertisedOrigin(cfg) + "/device.xml"
}

func buildSsdpUsn(cfg config.Config, searchTarget string) string {
	return hdhr.BuildDeviceUdn(cfg.DeviceID) + "::" + searchTarget
}

func finalizeSsdpPacket(lines []string) string {
	return strings.Join(lines, "\r\n") + "\r\n\r\n"
}

func buildSsdpNotifyPacket(cfg config.Config) string {
	return finalizeSsdpPacket([]string{
		"NOTIFY * HTTP/1.1",
		fmt.Sprintf("HOST: %s:%d", ssdpMulticastHost, ssdpMulticastPort),
		"NT: " + ssdpRootDeviceTarget,
		"NTS: ssdp:alive",
		"USN: " + buildSsdpUsn(cfg, ssdpRootDeviceTarget),
		"LOCATION: " + buildSsdpLocation(cfg),
		"SERVER: " + ssdpServerHeader,
		fmt.Sprintf("CACHE-CONTROL: max-age=%d", ssdpCacheMaxAgeSeconds),
	})
}

func buildSsdpSearchResponsePacket(cfg config.Config) string {
	return finalizeSsdpPacket([]string{
		"HTTP/1.1 200 OK",
		"EXT:",
		"ST: " + ssdpRootDeviceTarget,
		"USN: " + buildSsdpUsn(cfg, ssdpRootDeviceTarget),
		"LOCATION: " + buildSsdpLocation(cfg),
		"SERVER: " + ssdpServerHeader,
		fmt.Sprintf("CACHE-CONTROL: max-age=%d", ssdpCacheMaxAgeSeconds),
	})
}

func buildSsdpNotifyPackets(cfg config.Config) []string {
	return []string{buildSsdpNotifyPacket(cfg)}
}

func buildSsdpSearchResponses(cfg config.Config, searchTarget string) []string {
	switch searchTarget {
	case ssdpRootDeviceTarget, ssdpAllTarget:
		return []string{buildSsdpSearchResponsePacket(cfg)}
	default:
		return nil
	}
}

func buildHdhomerunDiscoveryReply(cfg config.Config) []byte {
	deviceType := make([]byte, 4)
	deviceType[3] = byte(hdhomerunDeviceTypeTuner)

	deviceIDBytes, err := hex.DecodeString(cfg.DeviceID)
	if err != nil {
		panic(err)
	}

	baseURL := advertisedOrigin(cfg)
	lineupURL := baseURL + "/lineup.json"

	payload := make([]byte, 0)
	payload = append(payload, encodeTag(hdhomerunTagDeviceID, deviceIDBytes)...)
	payload = append(payload, encodeTag(hdhomerunTagDeviceType, deviceType)...)
	payload = append(payload, encodeTag(hdhomerunTagTunerCount, []byte{byte(cfg.TunerCount)})...)
	payload = append(payload, encodeTag(hdhomerunTagDeviceAuth, []byte(cfg.DeviceAuth))...)
	payload = append(payload, encodeTag(hdhomerunTagBaseURL, []byte(baseURL))...)
	payload = append(payload, encodeTag(hdhomerunTagLineupURL, []byte(lineupURL))...)

	header := make([]byte, 4)
	header[0] = byte(hdhomerunTypeDiscoverReply >> 8)
	header[1] = byte(hdhomerunTypeDiscoverReply)
	header[2] = byte(len(payload) >> 8)
	header[3] = byte(len(payload))

	packet := append(header, payload...)
	crc := crc32IEEE(packet)
	trailer := []byte{
		byte(crc),
		byte(crc >> 8),
		byte(crc >> 16),
		byte(crc >> 24),
	}

	return append(packet, trailer...)
}

func advertisedOrigin(cfg config.Config) string {
	return cfg.AdvertisedBaseURL.Scheme + "://" + cfg.AdvertisedBaseURL.Host
}

func parseHdhomerunDiscoveryRequest(packet []byte) (*hdhomerunDiscoveryRequest, bool) {
	if len(packet) < 8 {
		return nil, false
	}

	packetType := readUint16BE(packet, 0)
	payloadLength := int(readUint16BE(packet, 2))
	totalLength := 4 + payloadLength + 4

	if packetType != hdhomerunTypeDiscoverRequest || len(packet) < totalLength {
		return nil, false
	}

	expectedCRC := crc32IEEE(packet[:totalLength-4])
	actualCRC := readUint32LE(packet, totalLength-4)
	if expectedCRC != actualCRC {
		return nil, false
	}

	request := &hdhomerunDiscoveryRequest{deviceTypes: []uint32{}}
	offset := 4
	limit := 4 + payloadLength
	for offset < limit {
		tag := packet[offset]
		offset++

		length := readHdhomerunVarLength(packet, offset)
		if length == nil {
			return nil, false
		}
		offset += length.byteLength

		valueOffset := offset
		valueLimit := valueOffset + length.value
		if valueLimit > limit {
			return nil, false
		}

		switch tag {
		case hdhomerunTagDeviceType:
			if length.value == 4 {
				request.deviceTypes = append(request.deviceTypes, readUint32BE(packet, valueOffset))
			}
		case hdhomerunTagMultiType:
			if length.value >= 4 && length.value%4 == 0 {
				for typeOffset := valueOffset; typeOffset < valueLimit; typeOffset += 4 {
					request.deviceTypes = append(request.deviceTypes, readUint32BE(packet, typeOffset))
				}
			}
		case hdhomerunTagDeviceID:
			if length.value == 4 {
				value := readUint32BE(packet, valueOffset)
				request.deviceID = &value
			}
		}

		offset = valueLimit
	}

	if len(request.deviceTypes) == 0 {
		return nil, false
	}

	return request, true
}

func requestMatchesConfig(request hdhomerunDiscoveryRequest, cfg config.Config) bool {
	matchesType := false
	for _, deviceType := range request.deviceTypes {
		if deviceType == hdhomerunDeviceTypeWildcard || deviceType == hdhomerunDeviceTypeTuner {
			matchesType = true
			break
		}
	}
	if !matchesType {
		return false
	}

	if request.deviceID == nil || *request.deviceID == hdhomerunDeviceTypeWildcard {
		return true
	}

	cfgDeviceID, err := parseHexDeviceID(cfg.DeviceID)
	if err != nil {
		return false
	}

	return *request.deviceID == cfgDeviceID
}

func parseHexDeviceID(value string) (uint32, error) {
	if len(value) != 8 {
		return 0, fmt.Errorf("invalid device id %q", value)
	}

	var parsed uint32
	for i := 0; i < len(value); i++ {
		parsed <<= 4
		switch {
		case value[i] >= '0' && value[i] <= '9':
			parsed |= uint32(value[i] - '0')
		case value[i] >= 'A' && value[i] <= 'F':
			parsed |= uint32(value[i]-'A') + 10
		case value[i] >= 'a' && value[i] <= 'f':
			parsed |= uint32(value[i]-'a') + 10
		default:
			return 0, fmt.Errorf("invalid device id %q", value)
		}
	}

	return parsed, nil
}
