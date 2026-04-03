package hdhr

import (
	"encoding/xml"
	"net/url"
)

type xmlRoot struct {
	XMLName     xml.Name      `xml:"root"`
	Xmlns       string        `xml:"xmlns,attr"`
	URLBase     string        `xml:"URLBase"`
	SpecVersion xmlSpec       `xml:"specVersion"`
	Device      xmlDeviceInfo `xml:"device"`
}

type xmlSpec struct {
	Major int `xml:"major"`
	Minor int `xml:"minor"`
}

type xmlDeviceInfo struct {
	DeviceType   string `xml:"deviceType"`
	FriendlyName string `xml:"friendlyName"`
	Manufacturer string `xml:"manufacturer"`
	ModelName    string `xml:"modelName"`
	ModelNumber  string `xml:"modelNumber"`
	SerialNumber string `xml:"serialNumber"`
	UDN          string `xml:"UDN"`
}

func BuildDeviceUdn(deviceID string) string {
	return "uuid:" + deviceID
}

func BuildDeviceXML(friendlyName, serialNumber string, presentationURL *url.URL, udn string) (string, error) {
	root := xmlRoot{
		Xmlns:   "urn:schemas-upnp-org:device-1-0",
		URLBase: presentationURL.Scheme + "://" + presentationURL.Host,
		SpecVersion: xmlSpec{
			Major: 1,
			Minor: 0,
		},
		Device: xmlDeviceInfo{
			DeviceType:   "urn:schemas-upnp-org:device:MediaServer:1",
			FriendlyName: friendlyName,
			Manufacturer: Manufacturer,
			ModelName:    ModelName,
			ModelNumber:  ModelNumber,
			SerialNumber: serialNumber,
			UDN:          udn,
		},
	}
	payload, err := xml.MarshalIndent(root, "", "  ")
	if err != nil {
		return "", err
	}
	return xml.Header + string(payload) + "\n", nil
}
