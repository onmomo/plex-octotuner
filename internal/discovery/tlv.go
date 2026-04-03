package discovery

import "hash/crc32"

type hdhomerunVarLength struct {
	byteLength int
	value      int
}

const (
	hdhomerunTypeDiscoverRequest = 0x0002
	hdhomerunTypeDiscoverReply   = 0x0003
	hdhomerunTypeGetSetRequest   = 0x0004
	hdhomerunTypeGetSetReply     = 0x0005

	hdhomerunTagDeviceType   = 0x01
	hdhomerunTagDeviceID     = 0x02
	hdhomerunTagGetSetName   = 0x03
	hdhomerunTagGetSetValue  = 0x04
	hdhomerunTagErrorMessage = 0x05
	hdhomerunTagTunerCount   = 0x10
	hdhomerunTagLineupURL    = 0x27
	hdhomerunTagBaseURL      = 0x2A
	hdhomerunTagDeviceAuth   = 0x2B
	hdhomerunTagMultiType    = 0x2D

	hdhomerunDeviceTypeWildcard = 0xFFFFFFFF
	hdhomerunDeviceTypeTuner    = 0x00000001
	hdhomerunDeviceTypeStorage  = 0x00000005
)

func encodeHdhomerunVarLength(length int) []byte {
	if length <= 0x7F {
		return []byte{byte(length)}
	}

	return []byte{
		byte((length & 0x7F) | 0x80),
		byte(length >> 7),
	}
}

func readHdhomerunVarLength(packet []byte, offset int) *hdhomerunVarLength {
	if offset >= len(packet) {
		return nil
	}

	firstByte := packet[offset]
	if firstByte&0x80 == 0 {
		return &hdhomerunVarLength{
			byteLength: 1,
			value:      int(firstByte),
		}
	}

	if offset+1 >= len(packet) {
		return nil
	}

	return &hdhomerunVarLength{
		byteLength: 2,
		value:      int(firstByte&0x7F) | int(packet[offset+1])<<7,
	}
}

func encodeTag(tag byte, value []byte) []byte {
	out := []byte{tag}
	out = append(out, encodeHdhomerunVarLength(len(value))...)
	out = append(out, value...)
	return out
}

func crc32IEEE(data []byte) uint32 {
	return crc32.ChecksumIEEE(data)
}

func readUint16BE(packet []byte, offset int) uint16 {
	return uint16(packet[offset])<<8 | uint16(packet[offset+1])
}

func readUint32BE(packet []byte, offset int) uint32 {
	return uint32(packet[offset])<<24 | uint32(packet[offset+1])<<16 | uint32(packet[offset+2])<<8 | uint32(packet[offset+3])
}

func readUint32LE(packet []byte, offset int) uint32 {
	return uint32(packet[offset]) | uint32(packet[offset+1])<<8 | uint32(packet[offset+2])<<16 | uint32(packet[offset+3])<<24
}
