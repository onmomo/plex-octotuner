package channels

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

var normalizePattern = regexp.MustCompile(`[^a-z0-9]+`)

func normalize(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	normalized = normalizePattern.ReplaceAllString(normalized, "-")
	return strings.Trim(normalized, "-")
}

func streamPathKey(streamURL string) string {
	parsed, err := url.Parse(streamURL)
	if err != nil {
		return streamURL
	}
	pathname := parsed.Path
	if pathname == "" {
		pathname = "/"
	}
	query := parsed.Query()
	keys := make([]string, 0, len(query))
	for key := range query {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var encoded []string
	for _, key := range keys {
		values := query[key]
		sort.Strings(values)
		for _, value := range values {
			encoded = append(encoded, url.QueryEscape(key)+"="+url.QueryEscape(value))
		}
	}
	if len(encoded) == 0 {
		return pathname
	}
	return pathname + "?" + strings.Join(encoded, "&")
}

func BuildChannelID(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])[:12]
}

func BuildChannelIdentity(tvgID, number, name, streamURL string) Identity {
	normalizedTVGID := normalize(tvgID)
	if normalizedTVGID != "" {
		return Identity{Key: "tvg-id:" + normalizedTVGID}
	}

	normalizedNumber := normalize(number)
	normalizedName := normalize(name)
	pathKey := streamPathKey(streamURL)

	switch {
	case normalizedNumber != "" && normalizedName != "":
		return Identity{Key: "number-name:" + normalizedNumber + ":" + normalizedName}
	case normalizedName != "":
		return Identity{Key: "name-path:" + normalizedName + ":" + pathKey}
	case normalizedNumber != "":
		return Identity{Key: "number-path:" + normalizedNumber + ":" + pathKey}
	default:
		return Identity{Key: "path:" + pathKey}
	}
}
