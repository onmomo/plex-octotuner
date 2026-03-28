export type DiscoverJsonInput = {
  friendlyName: string
  deviceId: string
  deviceAuth: string
  advertisedBaseUrl: URL
  tunerCount: number
}

const MANUFACTURER = 'Silicondust'
const MODEL_NUMBER = 'HDTC-2US'
const FIRMWARE_NAME = 'hdhomeruntc_atsc'
const FIRMWARE_VERSION = '20150826'

export function buildDiscoverJson(input: DiscoverJsonInput) {
  const baseUrl = input.advertisedBaseUrl.origin

  return {
    FriendlyName: input.friendlyName,
    Manufacturer: MANUFACTURER,
    ModelNumber: MODEL_NUMBER,
    FirmwareName: FIRMWARE_NAME,
    FirmwareVersion: FIRMWARE_VERSION,
    DeviceID: input.deviceId,
    DeviceAuth: input.deviceAuth,
    BaseURL: baseUrl,
    LineupURL: `${baseUrl}/lineup.json`,
    TunerCount: input.tunerCount
  }
}
