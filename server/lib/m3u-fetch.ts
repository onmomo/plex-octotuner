export async function fetchM3U(url: URL): Promise<string> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`failed to fetch playlist: ${response.status} ${response.statusText}`)
  }

  return response.text()
}
