import type { BridgeLogger } from './runtime'

const TS_PACKET_SIZE = 188
const RTP_HEADER_SEQUENCE_OFFSET = 2
const NULL_PACKET_PID = 0x1fff

type RelayTransportKind = 'tcp' | 'udp'

type RelayDiagnosticsContext = {
  logger: BridgeLogger
  transport: RelayTransportKind
  upstreamUrl: string
}

export type RelayDiagnostics = {
  recordRtpPacket(packet: Buffer): void
  recordTsPayload(payload: Buffer): void
  finish(): void
}

export function createRelayDiagnostics(context: RelayDiagnosticsContext): RelayDiagnostics {
  const { logger, transport, upstreamUrl } = context
  let lastRtpSequence: number | undefined
  let rtpPacketCount = 0
  let rtpMissingPacketCount = 0
  let tsPacketCount = 0
  let tsSyncLossCount = 0
  let tsContinuityErrorCount = 0
  let byteCount = 0
  let loggedRtpGap = false
  let loggedSyncLoss = false
  let loggedContinuityError = false
  const expectedContinuityByPid = new Map<number, number>()

  const recordRtpPacket = (packet: Buffer) => {
    if (packet.length < RTP_HEADER_SEQUENCE_OFFSET + 2) {
      return
    }

    const sequence = packet.readUInt16BE(RTP_HEADER_SEQUENCE_OFFSET)
    if (lastRtpSequence !== undefined) {
      const expected = (lastRtpSequence + 1) & 0xffff
      if (sequence !== expected) {
        const missedPackets = (sequence - expected + 0x1_0000) & 0xffff
        rtpMissingPacketCount += missedPackets

        if (!loggedRtpGap) {
          loggedRtpGap = true
          logger.warn('rtsp relay detected RTP sequence gap', {
            transport,
            upstreamUrl,
            expectedSequence: expected,
            actualSequence: sequence,
            missedPackets
          })
        }
      }
    }

    lastRtpSequence = sequence
    rtpPacketCount += 1
  }

  const recordTsPayload = (payload: Buffer) => {
    byteCount += payload.length

    for (let offset = 0; offset + TS_PACKET_SIZE <= payload.length; offset += TS_PACKET_SIZE) {
      const packet = payload.subarray(offset, offset + TS_PACKET_SIZE)
      tsPacketCount += 1

      if (packet[0] !== 0x47) {
        tsSyncLossCount += 1

        if (!loggedSyncLoss) {
          loggedSyncLoss = true
          logger.warn('rtsp relay detected MPEG-TS sync loss', {
            transport,
            upstreamUrl,
            offset,
            firstByte: packet[0]
          })
        }

        continue
      }

      const pid = ((packet[1] & 0x1f) << 8) | packet[2]
      const adaptationFieldControl = (packet[3] & 0x30) >> 4
      const continuityCounter = packet[3] & 0x0f
      const hasPayload = adaptationFieldControl === 1 || adaptationFieldControl === 3

      if (!hasPayload || pid === NULL_PACKET_PID) {
        continue
      }

      const expectedContinuity = expectedContinuityByPid.get(pid)
      if (expectedContinuity !== undefined && continuityCounter !== expectedContinuity) {
        tsContinuityErrorCount += 1

        if (!loggedContinuityError) {
          loggedContinuityError = true
          logger.warn('rtsp relay detected MPEG-TS continuity mismatch', {
            transport,
            upstreamUrl,
            pid,
            expectedContinuity,
            actualContinuity: continuityCounter
          })
        }
      }

      expectedContinuityByPid.set(pid, (continuityCounter + 1) & 0x0f)
    }
  }

  const finish = () => {
    logger.info('rtsp relay media ended', {
      transport,
      upstreamUrl,
      byteCount,
      rtpPacketCount,
      rtpMissingPacketCount,
      tsPacketCount,
      tsSyncLossCount,
      tsContinuityErrorCount
    })
  }

  return {
    recordRtpPacket,
    recordTsPayload,
    finish
  }
}
