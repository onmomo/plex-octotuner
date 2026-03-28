import { HDHR_DEVICE_PROFILE } from './profile'

export type DiscoverJsonInput = {
  friendlyName: string
  deviceId: string
  deviceAuth: string
  advertisedBaseUrl: URL
  tunerCount: number
}

export function buildDiscoverJson(input: DiscoverJsonInput) {
  const baseUrl = input.advertisedBaseUrl.origin

  return {
    FriendlyName: input.friendlyName,
    Manufacturer: HDHR_DEVICE_PROFILE.manufacturer,
    ModelNumber: HDHR_DEVICE_PROFILE.modelNumber,
    FirmwareName: HDHR_DEVICE_PROFILE.firmwareName,
    FirmwareVersion: HDHR_DEVICE_PROFILE.firmwareVersion,
    DeviceID: input.deviceId,
    DeviceAuth: input.deviceAuth,
    BaseURL: baseUrl,
    LineupURL: `${baseUrl}/lineup.json`,
    TunerCount: input.tunerCount
  }
}
