import { describe, expect, it, vi } from 'vitest'
import { createRelayDiagnostics } from '../../server/lib/rtsp-relay-diagnostics'

function buildTsPacket(continuityCounter: number, pid = 256, fill = 0x11): Buffer {
  const packet = Buffer.alloc(188, fill)
  packet[0] = 0x47
  packet[1] = (pid >> 8) & 0x1f
  packet[2] = pid & 0xff
  packet[3] = 0x10 | (continuityCounter & 0x0f)
  return packet
}

function buildRtpPacket(sequenceNumber: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(12)
  header[0] = 0x80
  header[1] = 33
  header.writeUInt16BE(sequenceNumber, 2)
  return Buffer.concat([header, payload])
}

describe('rtsp relay diagnostics', () => {
  it('summarizes a clean RTP/MPEG-TS relay session without warnings', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }

    const diagnostics = createRelayDiagnostics({
      logger,
      transport: 'udp',
      upstreamUrl: 'rtsp://octopus.local/stream?freq=354'
    })

    diagnostics.recordRtpPacket(buildRtpPacket(100, buildTsPacket(0)))
    diagnostics.recordTsPayload(Buffer.concat([buildTsPacket(0), buildTsPacket(1)]))
    diagnostics.finish()

    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('rtsp relay media ended', expect.objectContaining({
      transport: 'udp',
      byteCount: 376,
      rtpPacketCount: 1,
      rtpMissingPacketCount: 0,
      tsPacketCount: 2,
      tsSyncLossCount: 0,
      tsContinuityErrorCount: 0
    }))
  })

  it('warns when RTP packets are missing or MPEG-TS continuity breaks', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }

    const diagnostics = createRelayDiagnostics({
      logger,
      transport: 'udp',
      upstreamUrl: 'rtsp://octopus.local/stream?freq=354'
    })

    diagnostics.recordRtpPacket(buildRtpPacket(10, buildTsPacket(0)))
    diagnostics.recordRtpPacket(buildRtpPacket(13, buildTsPacket(1)))
    diagnostics.recordTsPayload(Buffer.concat([buildTsPacket(0), buildTsPacket(3)]))
    diagnostics.finish()

    expect(logger.warn).toHaveBeenCalledWith('rtsp relay detected RTP sequence gap', expect.objectContaining({
      expectedSequence: 11,
      actualSequence: 13,
      missedPackets: 2
    }))
    expect(logger.warn).toHaveBeenCalledWith('rtsp relay detected MPEG-TS continuity mismatch', expect.objectContaining({
      pid: 256,
      expectedContinuity: 1,
      actualContinuity: 3
    }))
    expect(logger.info).toHaveBeenCalledWith('rtsp relay media ended', expect.objectContaining({
      rtpMissingPacketCount: 2,
      tsContinuityErrorCount: 1
    }))
  })
})
