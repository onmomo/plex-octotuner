package rtsp

import (
	"sync"
	"time"
)

const (
	tsPacketSize                 = 188
	rtpHeaderSequenceOffset      = 2
	nullPacketPID                = 0x1fff
	rtpVersion                   = 2
	interleavedFrameMarker  byte = 0x24
)

type RelayDiagnostics interface {
	recordRtpPacket(packet []byte)
	recordTsPayload(payload []byte)
	finish()
}

type relayDiagnostics struct {
	logger          Logger
	transport       string
	upstreamURL     string
	lastRtpSeq      *uint16
	rtpPacketCount  int
	rtpMissingCount int
	tsPacketCount   int
	tsSyncLossCount int
	tsContinuityErr int
	byteCount       int
	loggedRtpGap    bool
	loggedSyncLoss  bool
	loggedContErr   bool
	expectedByPID   map[uint16]uint8
}

func createRelayDiagnostics(logger Logger, transport string, upstreamURL string) *relayDiagnostics {
	return &relayDiagnostics{
		logger:        logger,
		transport:     transport,
		upstreamURL:   upstreamURL,
		expectedByPID: map[uint16]uint8{},
	}
}

func (d *relayDiagnostics) recordRtpPacket(packet []byte) {
	if len(packet) < rtpHeaderSequenceOffset+2 {
		return
	}

	sequence := uint16(packet[rtpHeaderSequenceOffset])<<8 | uint16(packet[rtpHeaderSequenceOffset+1])
	if d.lastRtpSeq != nil {
		expected := *d.lastRtpSeq + 1
		if isStaleSequence(sequence, expected) {
			return
		}
		missed := sequenceDistance(expected, sequence)
		if sequence != expected {
			d.rtpMissingCount += int(missed)
			if !d.loggedRtpGap {
				d.loggedRtpGap = true
				d.logger.Warn("rtsp relay detected RTP sequence gap", map[string]any{
					"transport":        d.transport,
					"upstreamUrl":      d.upstreamURL,
					"expectedSequence": expected,
					"actualSequence":   sequence,
					"missedPackets":    missed,
				})
			}
		}
	}

	d.lastRtpSeq = &sequence
	d.rtpPacketCount++
}

func (d *relayDiagnostics) recordTsPayload(payload []byte) {
	d.byteCount += len(payload)

	for offset := 0; offset+tsPacketSize <= len(payload); offset += tsPacketSize {
		packet := payload[offset : offset+tsPacketSize]
		d.tsPacketCount++

		if packet[0] != 0x47 {
			d.tsSyncLossCount++
			if !d.loggedSyncLoss {
				d.loggedSyncLoss = true
				d.logger.Warn("rtsp relay detected MPEG-TS sync loss", map[string]any{
					"transport":   d.transport,
					"upstreamUrl": d.upstreamURL,
					"offset":      offset,
					"firstByte":   packet[0],
				})
			}
			continue
		}

		pid := (uint16(packet[1]&0x1f) << 8) | uint16(packet[2])
		adaptationFieldControl := (packet[3] & 0x30) >> 4
		continuityCounter := packet[3] & 0x0f
		hasPayload := adaptationFieldControl == 1 || adaptationFieldControl == 3
		hasDiscontinuity := false
		if adaptationFieldControl == 2 || adaptationFieldControl == 3 {
			adaptationFieldLength := int(packet[4])
			if adaptationFieldLength > 0 && 5 < len(packet) {
				hasDiscontinuity = (packet[5] & 0x80) != 0
			}
		}
		if hasDiscontinuity && !hasPayload {
			delete(d.expectedByPID, pid)
		}
		if !hasPayload || pid == nullPacketPID {
			continue
		}

		expected := d.expectedByPID[pid]
		if existing, ok := d.expectedByPID[pid]; ok && continuityCounter != existing && !hasDiscontinuity {
			d.tsContinuityErr++
			if !d.loggedContErr {
				d.loggedContErr = true
				d.logger.Warn("rtsp relay detected MPEG-TS continuity mismatch", map[string]any{
					"transport":          d.transport,
					"upstreamUrl":        d.upstreamURL,
					"pid":                pid,
					"expectedContinuity": expected,
					"actualContinuity":   continuityCounter,
				})
			}
		}

		d.expectedByPID[pid] = (continuityCounter + 1) & 0x0f
	}
}

func (d *relayDiagnostics) finish() {
	d.logger.Info("rtsp relay media ended", map[string]any{
		"transport":              d.transport,
		"upstreamUrl":            d.upstreamURL,
		"byteCount":              d.byteCount,
		"rtpPacketCount":         d.rtpPacketCount,
		"rtpMissingPacketCount":  d.rtpMissingCount,
		"tsPacketCount":          d.tsPacketCount,
		"tsSyncLossCount":        d.tsSyncLossCount,
		"tsContinuityErrorCount": d.tsContinuityErr,
	})
}

func sequenceDistance(from uint16, to uint16) uint16 {
	return uint16((int(to) - int(from) + 0x1_0000) & 0xffff)
}

func parseRtpSequence(packet []byte) uint16 {
	return uint16(packet[2])<<8 | uint16(packet[3])
}

type udpRtpReorderBuffer struct {
	mu           sync.Mutex
	expectedSeq  *uint16
	pending      map[uint16][]byte
	flushTimer   *time.Timer
	emitPacket   func([]byte)
	maxPending   int
	reorderDelay time.Duration
}

func newUdpRtpReorderBuffer(emitPacket func([]byte)) *udpRtpReorderBuffer {
	return &udpRtpReorderBuffer{
		pending:      map[uint16][]byte{},
		emitPacket:   emitPacket,
		maxPending:   64,
		reorderDelay: 20 * time.Millisecond,
	}
}

func (b *udpRtpReorderBuffer) push(packet []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()

	sequence := parseRtpSequence(packet)
	if b.expectedSeq == nil {
		b.expectedSeq = &sequence
	} else if isStaleSequence(sequence, *b.expectedSeq) {
		return
	}

	if _, exists := b.pending[sequence]; !exists {
		copyPacket := make([]byte, len(packet))
		copy(copyPacket, packet)
		b.pending[sequence] = copyPacket
	}

	b.flushAvailableLocked()

	if b.expectedSeq != nil && len(b.pending) > b.maxPending && !b.hasPending(*b.expectedSeq) {
		if next, ok := b.findNearestPendingSequence(); ok {
			b.expectedSeq = &next
			b.flushAvailableLocked()
		}
	}

	if len(b.pending) > 0 && b.expectedSeq != nil && !b.hasPending(*b.expectedSeq) {
		b.armFlushTimerLocked()
	}
}

func (b *udpRtpReorderBuffer) flushRemaining() {
	b.mu.Lock()
	defer b.mu.Unlock()

	for len(b.pending) > 0 {
		if b.expectedSeq == nil || !b.hasPending(*b.expectedSeq) {
			next, ok := b.findNearestPendingSequence()
			if !ok {
				return
			}
			b.expectedSeq = &next
		}
		b.flushAvailableLocked()
	}
}

func (b *udpRtpReorderBuffer) stop() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.flushTimer != nil {
		b.flushTimer.Stop()
		b.flushTimer = nil
	}
}

func (b *udpRtpReorderBuffer) close() {
	b.stop()
	b.flushRemaining()
}

func (b *udpRtpReorderBuffer) flushAvailableLocked() {
	if b.expectedSeq == nil {
		return
	}

	for {
		packet, ok := b.pending[*b.expectedSeq]
		if !ok {
			break
		}
		delete(b.pending, *b.expectedSeq)
		b.emitPacket(packet)
		next := *b.expectedSeq + 1
		b.expectedSeq = &next
	}

	if len(b.pending) == 0 && b.flushTimer != nil {
		b.flushTimer.Stop()
		b.flushTimer = nil
	}
}

func (b *udpRtpReorderBuffer) armFlushTimerLocked() {
	if b.flushTimer != nil {
		return
	}
	b.flushTimer = time.AfterFunc(b.reorderDelay, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		b.flushTimer = nil
		if len(b.pending) == 0 {
			return
		}
		if b.expectedSeq == nil || !b.hasPending(*b.expectedSeq) {
			if next, ok := b.findNearestPendingSequence(); ok {
				b.expectedSeq = &next
			}
		}
		b.flushAvailableLocked()
		if len(b.pending) > 0 && b.expectedSeq != nil && !b.hasPending(*b.expectedSeq) {
			b.armFlushTimerLocked()
		}
	})
}

func (b *udpRtpReorderBuffer) hasPending(sequence uint16) bool {
	_, ok := b.pending[sequence]
	return ok
}

func (b *udpRtpReorderBuffer) findNearestPendingSequence() (uint16, bool) {
	var (
		nearest uint16
		found   bool
		dist    uint16
	)

	if b.expectedSeq == nil {
		for sequence := range b.pending {
			return sequence, true
		}
		return 0, false
	}

	for sequence := range b.pending {
		current := sequenceDistance(*b.expectedSeq, sequence)
		if !found || current < dist {
			nearest = sequence
			dist = current
			found = true
		}
	}

	return nearest, found
}

func isStaleSequence(sequence uint16, expected uint16) bool {
	return sequenceDistance(expected, sequence) > 0x7fff
}
