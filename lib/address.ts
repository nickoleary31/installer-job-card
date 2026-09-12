/**
 * Collapses a stored multiline address (e.g. "5811 Priest Rd\nAcworth, GA 30102") into a single
 * line for copy/map actions only ("5811 Priest Rd, Acworth, GA 30102"). Never used to overwrite
 * the stored value — the multiline form stays canonical everywhere it's rendered.
 */
export function toSingleLineAddress(address: string): string {
  return address
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Universal web URLs for each map provider — no Maps API key, no geocoding call. Each is also a
 * deep link: opened on a device with the matching app installed, the OS/browser routes it into
 * the native app; otherwise it falls back to that provider's normal web result automatically.
 */
export function buildGoogleMapsUrl(singleLineAddress: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(singleLineAddress)}`;
}

export function buildAppleMapsUrl(singleLineAddress: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(singleLineAddress)}`;
}

export function buildWazeUrl(singleLineAddress: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(singleLineAddress)}&navigate=yes`;
}
