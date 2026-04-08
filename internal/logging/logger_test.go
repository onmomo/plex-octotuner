package logging

import (
	"errors"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// ---- sanitizeURLText -------------------------------------------------------

func TestSanitizeURLTextLeavesPlainTextAlone(t *testing.T) {
	in := "no URLs here, just plain text"
	got := sanitizeURLText(in)
	if got != in {
		t.Errorf("sanitizeURLText(%q) = %q, want unchanged", in, got)
	}
}

func TestSanitizeURLTextStripsCredentials(t *testing.T) {
	got := sanitizeURLText("stream at http://user:secret@host.com/path")
	if strings.Contains(got, "user") || strings.Contains(got, "secret") {
		t.Errorf("sanitizeURLText left credentials in output: %q", got)
	}
	if !strings.Contains(got, "http://host.com/path") {
		t.Errorf("sanitizeURLText removed too much, got: %q", got)
	}
}

func TestSanitizeURLTextStripsQueryString(t *testing.T) {
	got := sanitizeURLText("see http://host.com/stream?token=abc&foo=bar here")
	if strings.Contains(got, "token") || strings.Contains(got, "foo") {
		t.Errorf("sanitizeURLText left query in output: %q", got)
	}
	if !strings.Contains(got, "http://host.com/stream") {
		t.Errorf("sanitizeURLText over-stripped, got: %q", got)
	}
}

func TestSanitizeURLTextStripsFragment(t *testing.T) {
	got := sanitizeURLText("go to http://host.com/page#section")
	if strings.Contains(got, "section") {
		t.Errorf("sanitizeURLText left fragment in output: %q", got)
	}
}

func TestSanitizeURLTextHandlesMultipleURLs(t *testing.T) {
	in := "first http://user:pw@a.com/?x=1 and second http://b.com/path"
	got := sanitizeURLText(in)
	if strings.Contains(got, "pw") || strings.Contains(got, "x=1") {
		t.Errorf("sanitizeURLText left sensitive data: %q", got)
	}
	if !strings.Contains(got, "http://a.com/") || !strings.Contains(got, "http://b.com/path") {
		t.Errorf("sanitizeURLText dropped URL host/path: %q", got)
	}
}

func TestSanitizeURLTextPreservesNonHTTPText(t *testing.T) {
	// rtsp:// URLs are not matched by the https?:// pattern — should pass through
	in := "rtsp://user:secret@host.com/stream"
	got := sanitizeURLText(in)
	if got != in {
		t.Errorf("non-http URL should be untouched, got: %q", got)
	}
}

// ---- sanitizeValue ---------------------------------------------------------

func TestSanitizeValueString(t *testing.T) {
	got := sanitizeValue("http://user:pw@host.com/?q=1", false)
	s, ok := got.(string)
	if !ok {
		t.Fatalf("expected string, got %T", got)
	}
	if strings.Contains(s, "pw") || strings.Contains(s, "q=1") {
		t.Errorf("sanitizeValue(string) left sensitive data: %q", s)
	}
}

func TestSanitizeValueNilURL(t *testing.T) {
	got := sanitizeValue((*url.URL)(nil), false)
	if got != nil {
		t.Errorf("sanitizeValue(nil *url.URL) = %v, want nil", got)
	}
}

func TestSanitizeValueURL(t *testing.T) {
	u, _ := url.Parse("http://user:pw@192.168.1.1:554/stream?token=secret#frag")
	got := sanitizeValue(u, false)
	s, ok := got.(string)
	if !ok {
		t.Fatalf("expected string, got %T", got)
	}
	if strings.Contains(s, "pw") || strings.Contains(s, "secret") || strings.Contains(s, "frag") {
		t.Errorf("sanitizeValue(*url.URL) left sensitive data: %q", s)
	}
	if !strings.Contains(s, "192.168.1.1:554") {
		t.Errorf("sanitizeValue(*url.URL) stripped too much: %q", s)
	}
}

func TestSanitizeValueMapSanitizesEntries(t *testing.T) {
	m := map[string]any{
		"url":  "http://user:pw@host.com/?q=1",
		"name": "plain text",
	}
	got := sanitizeValue(m, false)
	result, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", got)
	}
	if strings.Contains(result["url"].(string), "pw") {
		t.Errorf("map url entry not sanitized: %v", result["url"])
	}
	if result["name"] != "plain text" {
		t.Errorf("plain text entry modified: %v", result["name"])
	}
}

func TestSanitizeValueMapPreservesUpstreamURLWhenFlagged(t *testing.T) {
	rawURL := "http://user:pw@host.com/?token=secret"
	m := map[string]any{"upstreamUrl": rawURL}
	got := sanitizeValue(m, true)
	result := got.(map[string]any)
	if result["upstreamUrl"] != rawURL {
		t.Errorf("upstreamUrl was modified when preserveUpstreamURL=true: %v", result["upstreamUrl"])
	}
}

func TestSanitizeValueMapSanitizesUpstreamURLWhenNotFlagged(t *testing.T) {
	rawURL := "http://user:pw@host.com/?token=secret"
	m := map[string]any{"upstreamUrl": rawURL}
	got := sanitizeValue(m, false)
	result := got.(map[string]any)
	s := result["upstreamUrl"].(string)
	if strings.Contains(s, "pw") || strings.Contains(s, "secret") {
		t.Errorf("upstreamUrl not sanitized when preserveUpstreamURL=false: %q", s)
	}
}

func TestSanitizeValueError(t *testing.T) {
	err := errors.New("dial http://user:pw@host.com/ failed")
	got := sanitizeValue(err, false)
	m, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("expected map for error, got %T", got)
	}
	if m["name"] != "Error" {
		t.Errorf("error name = %v, want \"Error\"", m["name"])
	}
	msg, _ := m["message"].(string)
	if strings.Contains(msg, "pw") {
		t.Errorf("error message not sanitized: %q", msg)
	}
}

func TestSanitizeValueSlice(t *testing.T) {
	input := []any{"http://user:pw@host.com/", "plain"}
	got := sanitizeValue(input, false)
	result, ok := got.([]any)
	if !ok {
		t.Fatalf("expected []any, got %T", got)
	}
	if len(result) != 2 {
		t.Fatalf("expected 2 items, got %d", len(result))
	}
	if strings.Contains(result[0].(string), "pw") {
		t.Errorf("slice entry not sanitized: %v", result[0])
	}
	if result[1] != "plain" {
		t.Errorf("plain slice entry modified: %v", result[1])
	}
}

func TestSanitizeValuePassesThroughUnknownType(t *testing.T) {
	got := sanitizeValue(42, false)
	if got != 42 {
		t.Errorf("expected int 42 to pass through, got %v", got)
	}
}

// ---- formatLogLine ---------------------------------------------------------

func TestFormatLogLineNilContext(t *testing.T) {
	got := formatLogLine("hello world", nil)
	if got != "hello world" {
		t.Errorf("formatLogLine with nil context = %q, want %q", got, "hello world")
	}
}

func TestFormatLogLineNilContextSanitizesMessage(t *testing.T) {
	got := formatLogLine("connect http://user:pw@host.com/", nil)
	if strings.Contains(got, "pw") {
		t.Errorf("formatLogLine did not sanitize message URL: %q", got)
	}
}

func TestFormatLogLineIncludesContext(t *testing.T) {
	got := formatLogLine("event", map[string]any{"key": "value"})
	if !strings.Contains(got, "event") {
		t.Errorf("formatLogLine output missing message: %q", got)
	}
	if !strings.Contains(got, `"key"`) || !strings.Contains(got, `"value"`) {
		t.Errorf("formatLogLine output missing context JSON: %q", got)
	}
}

func TestFormatLogLinePlaybackStartedPreservesUpstreamURL(t *testing.T) {
	rawURL := "http://user:pw@host.com/?token=secret"
	got := formatLogLine(playbackStartedMessage, map[string]any{"upstreamUrl": rawURL})
	if !strings.Contains(got, rawURL) {
		t.Errorf("playbackStartedMessage should preserve upstreamUrl, got: %q", got)
	}
}

func TestFormatLogLineOtherMessageSanitizesUpstreamURL(t *testing.T) {
	rawURL := "http://user:pw@host.com/?token=secret"
	got := formatLogLine("some other message", map[string]any{"upstreamUrl": rawURL})
	if strings.Contains(got, "pw") || strings.Contains(got, "secret") {
		t.Errorf("non-playback message should sanitize upstreamUrl, got: %q", got)
	}
}

// ---- Logger ----------------------------------------------------------------

func TestLoggerNewCreatesEmptySink(t *testing.T) {
	l := New()
	if len(l.Sink) != 0 {
		t.Errorf("New() sink should be empty, got %d entries", len(l.Sink))
	}
}

func TestLoggerInfoAppendsLine(t *testing.T) {
	l := New()
	l.Info("test info", nil)
	if len(l.Sink) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(l.Sink))
	}
	if !strings.Contains(l.Sink[0], "test info") {
		t.Errorf("Sink entry missing message: %q", l.Sink[0])
	}
}

func TestLoggerWarnAppendsLine(t *testing.T) {
	l := New()
	l.Warn("test warn", nil)
	if len(l.Sink) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(l.Sink))
	}
	if !strings.Contains(l.Sink[0], "test warn") {
		t.Errorf("Sink entry missing message: %q", l.Sink[0])
	}
}

func TestLoggerErrorAppendsLine(t *testing.T) {
	l := New()
	l.Error("test error", nil)
	if len(l.Sink) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(l.Sink))
	}
	if !strings.Contains(l.Sink[0], "test error") {
		t.Errorf("Sink entry missing message: %q", l.Sink[0])
	}
}

func TestLoggerCapAt200Entries(t *testing.T) {
	l := New()
	for i := 0; i < 210; i++ {
		l.Info("msg", map[string]any{"i": i})
	}
	if len(l.Sink) > 200 {
		t.Errorf("Sink grew beyond 200 entries: %d", len(l.Sink))
	}
}

func TestLoggerConcurrentAppendIsSafe(t *testing.T) {
	l := New()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			l.Info("concurrent", nil)
		}()
	}
	wg.Wait()
	if len(l.Sink) == 0 {
		t.Error("expected entries after concurrent writes")
	}
}
