package hdhr

import "net/url"

type DiscoverResponse struct {
	FriendlyName    string
	Manufacturer    string
	ModelNumber     string
	FirmwareName    string
	FirmwareVersion string
	DeviceID        string
	DeviceAuth      string
	BaseURL         string
	LineupURL       string
	TunerCount      int
}

func BuildDiscoverJSON(friendlyName, deviceID, deviceAuth string, baseURL *url.URL, tunerCount int) DiscoverResponse {
	origin := baseURL.Scheme + "://" + baseURL.Host
	return DiscoverResponse{
		FriendlyName:    friendlyName,
		Manufacturer:    Manufacturer,
		ModelNumber:     ModelNumber,
		FirmwareName:    FirmwareName,
		FirmwareVersion: FirmwareVersion,
		DeviceID:        deviceID,
		DeviceAuth:      deviceAuth,
		BaseURL:         origin,
		LineupURL:       origin + "/lineup.json",
		TunerCount:      tunerCount,
	}
}
