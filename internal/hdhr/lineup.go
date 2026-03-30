package hdhr

import (
	"net/url"
	"plex-octotuner/internal/channels"
	"strconv"
)

type LineupEntry struct {
	GuideNumber string `json:"GuideNumber"`
	GuideName   string `json:"GuideName"`
	URL         string `json:"URL"`
}

func BuildLineup(input []channels.Channel, baseURL *url.URL) []LineupEntry {
	next := make([]LineupEntry, 0, len(input))
	for _, channel := range input {
		guideNumber := channel.Number
		if guideNumber == "" {
			guideNumber = strconv.Itoa(channel.SourceIndex + 1)
		}
		next = append(next, LineupEntry{
			GuideNumber: guideNumber,
			GuideName:   channel.Name,
			URL:         baseURL.ResolveReference(&url.URL{Path: "/auto/v" + channel.ID}).String(),
		})
	}
	return next
}

type LineupStatus struct {
	ScanInProgress int      `json:"ScanInProgress"`
	ScanPossible   int      `json:"ScanPossible"`
	Source         string   `json:"Source"`
	SourceList     []string `json:"SourceList"`
}

func BuildLineupStatus() LineupStatus {
	return LineupStatus{
		ScanInProgress: 0,
		ScanPossible:   0,
		Source:         "Cable",
		SourceList:     []string{"Cable"},
	}
}
