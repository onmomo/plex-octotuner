export function buildAdvertisedFriendlyName(friendlyName: string): string {
  return /^HDHomerun\s*\(/i.test(friendlyName)
    ? friendlyName
    : `HDHomerun (${friendlyName})`
}
