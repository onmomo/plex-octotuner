export type HdhomerunVarLength = {
  byteLength: number
  value: number
}

export function encodeHdhomerunVarLength(length: number): Buffer {
  if (length <= 0x7F) {
    return Buffer.from([length])
  }

  return Buffer.from([
    (length & 0x7F) | 0x80,
    length >> 7
  ])
}

export function readHdhomerunVarLength(packet: Buffer, offset: number): HdhomerunVarLength | null {
  if (offset >= packet.length) {
    return null
  }

  const firstByte = packet[offset]
  if ((firstByte & 0x80) === 0) {
    return {
      byteLength: 1,
      value: firstByte
    }
  }

  if (offset + 1 >= packet.length) {
    return null
  }

  return {
    byteLength: 2,
    value: (firstByte & 0x7F) | (packet[offset + 1] << 7)
  }
}
