package channels

import (
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type WarnLogger interface {
	Warn(message string, context any)
}

var (
	attributePattern   = regexp.MustCompile(`([A-Za-z0-9_-]+)="([^"]*)"`)
	allowedSchemes     = map[string]struct{}{"http": {}, "https": {}, "rtsp": {}, "rtsps": {}}
	numericGuideNumber = regexp.MustCompile(`^\d+$`)
)

type pendingChannel struct {
	TVGID      string
	Number     string
	Name       string
	LogoURL    string
	GroupTitle string
	LineNumber int
}

func ParseM3U(playlist string, logger WarnLogger) []Channel {
	lines := strings.Split(playlist, "\n")
	channels := make([]Channel, 0)
	var pending *pendingChannel
	sourceIndex := 0

	dropPending := func(reason string) {
		if pending == nil {
			return
		}
		logger.Warn(fmt.Sprintf("dropped invalid channel at line %d: %s", pending.LineNumber, reason), nil)
		pending = nil
	}

	finalizePending := func(streamURL string) {
		if pending == nil {
			return
		}
		identity := BuildChannelIdentity(pending.TVGID, pending.Number, pending.Name, streamURL)
		channels = append(channels, Channel{
			ID:          BuildChannelID(identity.Key),
			SourceIndex: sourceIndex,
			Identity:    identity,
			TVGID:       pending.TVGID,
			Number:      pending.Number,
			Name:        pending.Name,
			LogoURL:     pending.LogoURL,
			GroupTitle:  pending.GroupTitle,
			StreamURL:   streamURL,
		})
		sourceIndex++
		pending = nil
	}

	for index, rawLine := range lines {
		lineNumber := index + 1
		line := strings.TrimSpace(rawLine)
		if line == "" || line == "#EXTM3U" {
			continue
		}

		if extInf, ok := parseExtInf(line); ok {
			dropPending("missing stream url")
			pending = &pendingChannel{
				TVGID:      extInf.TVGID,
				Number:     extInf.Number,
				Name:       extInf.Name,
				LogoURL:    extInf.LogoURL,
				GroupTitle: extInf.GroupTitle,
				LineNumber: lineNumber,
			}
			continue
		}

		if strings.HasPrefix(line, "#EXTINF:") {
			logger.Warn(fmt.Sprintf("dropped invalid channel at line %d: malformed metadata", lineNumber), nil)
			continue
		}

		if strings.HasPrefix(line, "#") {
			continue
		}

		if !isAllowedStreamURL(rawLine) {
			if pending != nil {
				dropPending("unsupported or invalid stream url")
			} else {
				logger.Warn(fmt.Sprintf("dropped invalid channel at line %d: unexpected stream url", lineNumber), nil)
			}
			continue
		}

		if pending == nil {
			logger.Warn(fmt.Sprintf("dropped invalid channel at line %d: stream url without metadata", lineNumber), nil)
			continue
		}

		finalizePending(rawLine)
	}

	dropPending("missing stream url")

	sort.Slice(channels, func(i, j int) bool {
		return compareChannels(channels[i], channels[j]) < 0
	})

	ordered := make([]Channel, 0, len(channels))
	seen := map[string]struct{}{}
	for _, channel := range channels {
		if _, exists := seen[channel.Identity.Key]; exists {
			logger.Warn(fmt.Sprintf("dropped duplicate channel: %s", channel.Identity.Key), nil)
			continue
		}
		seen[channel.Identity.Key] = struct{}{}
		ordered = append(ordered, channel)
	}

	return ordered
}

type parsedExtInf struct {
	TVGID      string
	Number     string
	Name       string
	LogoURL    string
	GroupTitle string
}

func parseExtInf(line string) (parsedExtInf, bool) {
	if !strings.HasPrefix(line, "#EXTINF:") {
		return parsedExtInf{}, false
	}

	separatorIndex := findExtInfSeparator(line)
	if separatorIndex < 0 {
		return parsedExtInf{}, false
	}

	header := line[:separatorIndex]
	name := strings.TrimSpace(line[separatorIndex+1:])
	if name == "" {
		return parsedExtInf{}, false
	}

	attributes := map[string]string{}
	for _, match := range attributePattern.FindAllStringSubmatch(header, -1) {
		attributes[strings.ToLower(match[1])] = match[2]
	}

	return parsedExtInf{
		TVGID:      attributes["tvg-id"],
		Number:     attributes["tvg-chno"],
		Name:       name,
		LogoURL:    attributes["tvg-logo"],
		GroupTitle: attributes["group-title"],
	}, true
}

func findExtInfSeparator(line string) int {
	inQuotes := false
	for index := len("#EXTINF:"); index < len(line); index++ {
		switch line[index] {
		case '"':
			inQuotes = !inQuotes
		case ',':
			if !inQuotes {
				return index
			}
		}
	}
	return -1
}

func isAllowedStreamURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" {
		return false
	}
	_, ok := allowedSchemes[parsed.Scheme]
	return ok
}

func compareChannels(left, right Channel) int {
	leftHasNumber := numericGuideNumber.MatchString(left.Number)
	rightHasNumber := numericGuideNumber.MatchString(right.Number)

	if leftHasNumber && rightHasNumber {
		leftNumber, _ := strconv.Atoi(left.Number)
		rightNumber, _ := strconv.Atoi(right.Number)
		if leftNumber != rightNumber {
			if leftNumber < rightNumber {
				return -1
			}
			return 1
		}
	}

	if leftHasNumber != rightHasNumber {
		if leftHasNumber {
			return -1
		}
		return 1
	}

	leftName := strings.ToLower(left.Name)
	rightName := strings.ToLower(right.Name)
	if leftName != rightName {
		if leftName < rightName {
			return -1
		}
		return 1
	}

	if left.Identity.Key < right.Identity.Key {
		return -1
	}
	if left.Identity.Key > right.Identity.Key {
		return 1
	}
	return 0
}
