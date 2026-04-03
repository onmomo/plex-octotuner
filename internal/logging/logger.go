package logging

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
)

const playbackStartedMessage = "channel playback started"

var urlInTextPattern = regexp.MustCompile(`https?://[^\s"'<>]+`)

type Logger struct {
	mu   sync.Mutex
	Sink []string
}

func New() *Logger {
	return &Logger{Sink: make([]string, 0, 200)}
}

func (l *Logger) Info(message string, context any) {
	l.append(formatLogLine(message, context))
}

func (l *Logger) Warn(message string, context any) {
	l.append(formatLogLine(message, context))
}

func (l *Logger) Error(message string, context any) {
	l.append(formatLogLine(message, context))
}

func (l *Logger) append(line string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.Sink = append(l.Sink, line)
	if len(l.Sink) > 200 {
		l.Sink = l.Sink[len(l.Sink)-200:]
	}
	fmt.Println(line)
}

func formatLogLine(message string, context any) string {
	if context == nil {
		return sanitizeURLText(message)
	}
	preserveUpstreamURL := message == playbackStartedMessage
	sanitized := sanitizeValue(context, preserveUpstreamURL)
	encoded, err := json.Marshal(sanitized)
	if err != nil {
		return sanitizeURLText(message)
	}
	return sanitizeURLText(message) + " " + string(encoded)
}

func sanitizeURLText(value string) string {
	return urlInTextPattern.ReplaceAllStringFunc(value, func(candidate string) string {
		parsed, err := url.Parse(candidate)
		if err != nil {
			return strings.Split(strings.Split(candidate, "?")[0], "#")[0]
		}
		parsed.User = nil
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return parsed.String()
	})
}

func sanitizeValue(value any, preserveUpstreamURL bool) any {
	switch typed := value.(type) {
	case string:
		return sanitizeURLText(typed)
	case *url.URL:
		if typed == nil {
			return nil
		}
		copyURL := *typed
		copyURL.User = nil
		copyURL.RawQuery = ""
		copyURL.Fragment = ""
		return copyURL.String()
	case map[string]any:
		next := map[string]any{}
		for key, entry := range typed {
			if preserveUpstreamURL && key == "upstreamUrl" {
				next[key] = entry
				continue
			}
			next[key] = sanitizeValue(entry, preserveUpstreamURL)
		}
		return next
	case error:
		return map[string]any{
			"name":    "Error",
			"message": sanitizeURLText(typed.Error()),
		}
	case []any:
		next := make([]any, 0, len(typed))
		for _, entry := range typed {
			next = append(next, sanitizeValue(entry, preserveUpstreamURL))
		}
		return next
	default:
		return value
	}
}
