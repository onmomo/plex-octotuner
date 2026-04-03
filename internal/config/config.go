package config

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const (
	DefaultServerPort            = 34400
	DefaultFriendlyName          = "octotuner"
	DefaultPlaylistRefreshSecond = 300
	DefaultTunerCount            = 4
	DefaultDeviceID              = "105A1B22"
	HdhomerunMaxTunerCount       = 255
)

var (
	deviceIDPattern   = regexp.MustCompile(`^[A-F0-9]{8}$`)
	httpSchemes       = map[string]struct{}{"http": {}, "https": {}}
	deviceIDLookupTbl = [16]uint32{0xA, 0x5, 0xF, 0x6, 0x7, 0xC, 0x1, 0xB, 0x9, 0x2, 0x8, 0xD, 0x4, 0x3, 0xE, 0x0}
)

type Config struct {
	M3UURL                 *url.URL
	AdvertisedBaseURL      *url.URL
	ServerPort             int
	FriendlyName           string
	PlaylistRefreshSeconds int
	TunerCount             int
	DeviceID               string
	DeviceAuth             string
}

func Load(env map[string]string) (Config, error) {
	m3uURL, err := parseURL(env, "M3U_URL")
	if err != nil {
		return Config{}, err
	}

	advertisedBaseURL, err := parseURL(env, "ADVERTISED_BASE_URL")
	if err != nil {
		return Config{}, err
	}

	if err := requireExplicitPort(advertisedBaseURL, "ADVERTISED_BASE_URL"); err != nil {
		return Config{}, err
	}

	if err := requireOriginOnlyBaseURL(advertisedBaseURL, "ADVERTISED_BASE_URL"); err != nil {
		return Config{}, err
	}

	serverPort, err := parsePort(env["SERVER_PORT"], "SERVER_PORT", DefaultServerPort)
	if err != nil {
		return Config{}, err
	}

	friendlyName := strings.TrimSpace(env["HDHR_FRIENDLY_NAME"])
	if friendlyName == "" {
		friendlyName = DefaultFriendlyName
	}

	refreshSeconds, err := parsePositiveInt(env["PLAYLIST_REFRESH_SECONDS"], "PLAYLIST_REFRESH_SECONDS", DefaultPlaylistRefreshSecond, 0)
	if err != nil {
		return Config{}, err
	}

	tunerCount, err := parsePositiveInt(env["HDHR_TUNER_COUNT"], "HDHR_TUNER_COUNT", DefaultTunerCount, HdhomerunMaxTunerCount)
	if err != nil {
		return Config{}, err
	}

	deviceID, err := normalizeDeviceID(defaultString(env["HDHR_DEVICE_ID"], DefaultDeviceID))
	if err != nil {
		return Config{}, err
	}

	deviceAuth := env["HDHR_DEVICE_AUTH"]
	if deviceAuth == "" {
		deviceAuth = "octotuner-" + deviceID
	}

	if strings.TrimSpace(deviceAuth) == "" {
		return Config{}, errors.New("HDHR_DEVICE_AUTH must not be blank")
	}

	if serverPort != portFromURL(advertisedBaseURL) {
		return Config{}, errors.New("SERVER_PORT must match the port in ADVERTISED_BASE_URL")
	}

	return Config{
		M3UURL:                 m3uURL,
		AdvertisedBaseURL:      advertisedBaseURL,
		ServerPort:             serverPort,
		FriendlyName:           friendlyName,
		PlaylistRefreshSeconds: refreshSeconds,
		TunerCount:             tunerCount,
		DeviceID:               deviceID,
		DeviceAuth:             deviceAuth,
	}, nil
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func parseURL(env map[string]string, key string) (*url.URL, error) {
	value, ok := env[key]
	if !ok || value == "" {
		return nil, fmt.Errorf("%s is required", key)
	}

	if strings.TrimSpace(value) != value {
		return nil, fmt.Errorf("%s must not contain leading or trailing whitespace", key)
	}

	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("%s must be a valid URL", key)
	}

	if _, ok := httpSchemes[parsed.Scheme]; !ok {
		return nil, fmt.Errorf("%s must use http or https", key)
	}

	return parsed, nil
}

func requireExplicitPort(value *url.URL, key string) error {
	if value.Port() == "" {
		return fmt.Errorf("%s must include an explicit port", key)
	}
	return nil
}

func requireOriginOnlyBaseURL(value *url.URL, key string) error {
	if value.User != nil {
		return fmt.Errorf("%s must not include credentials", key)
	}
	if value.Path != "" && value.Path != "/" || value.RawQuery != "" || value.Fragment != "" {
		return fmt.Errorf("%s must be an origin-only URL", key)
	}
	return nil
}

func parsePort(value, key string, fallback int) (int, error) {
	if value == "" {
		return fallback, nil
	}
	if !regexp.MustCompile(`^(0|[1-9]\d*)$`).MatchString(value) {
		return 0, fmt.Errorf("%s must be a plain decimal integer", key)
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 || parsed > 65535 {
		return 0, fmt.Errorf("%s must be a valid TCP port", key)
	}
	return parsed, nil
}

func parsePositiveInt(value, key string, fallback, max int) (int, error) {
	if value == "" {
		return fallback, nil
	}
	if !regexp.MustCompile(`^(0|[1-9]\d*)$`).MatchString(value) {
		return 0, fmt.Errorf("%s must be a plain decimal integer", key)
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	if max > 0 && parsed > max {
		return 0, fmt.Errorf("%s must be less than or equal to %d", key, max)
	}
	return parsed, nil
}

func normalizeDeviceID(value string) (string, error) {
	deviceID := strings.ToUpper(strings.TrimSpace(value))
	if !deviceIDPattern.MatchString(deviceID) {
		return "", errors.New("HDHR_DEVICE_ID must be an 8-character hexadecimal identifier")
	}
	if !isValidHdhomerunDeviceID(deviceID) {
		return "", errors.New("HDHR_DEVICE_ID must be a valid HDHomeRun device identifier")
	}
	return deviceID, nil
}

func isValidHdhomerunDeviceID(deviceID string) bool {
	value, err := strconv.ParseUint(deviceID, 16, 32)
	if err != nil {
		return false
	}

	var checksum uint32
	checksum ^= deviceIDLookupTbl[(value>>28)&0x0F]
	checksum ^= uint32((value >> 24) & 0x0F)
	checksum ^= deviceIDLookupTbl[(value>>20)&0x0F]
	checksum ^= uint32((value >> 16) & 0x0F)
	checksum ^= deviceIDLookupTbl[(value>>12)&0x0F]
	checksum ^= uint32((value >> 8) & 0x0F)
	checksum ^= deviceIDLookupTbl[(value>>4)&0x0F]
	checksum ^= uint32(value & 0x0F)

	return checksum == 0
}

func portFromURL(value *url.URL) int {
	if value.Port() != "" {
		parsed, _ := strconv.Atoi(value.Port())
		return parsed
	}
	if value.Scheme == "https" {
		return 443
	}
	return 80
}
