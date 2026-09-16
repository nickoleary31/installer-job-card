/**
 * Central helper for addressing Installer Sheetz's own /api/** routes from
 * shared client code, so no component hardcodes a hostname.
 *
 * Web build: NEXT_PUBLIC_API_ORIGIN is unset, so apiUrl returns the path
 * unchanged — current same-origin relative-fetch behavior, byte for byte.
 *
 * mobile-web build: NEXT_PUBLIC_API_ORIGIN is set to the hosted Installer
 * Sheetz origin (e.g. https://installer-job-card.vercel.app), so apiUrl
 * returns an absolute URL the packaged UI can call cross-origin. This is a
 * public hostname, not a secret — never put credentials in this variable.
 */
export function apiUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`apiUrl() requires a leading "/", got: ${path}`);
  }
  const origin = (process.env.NEXT_PUBLIC_API_ORIGIN || "").replace(/\/+$/, "");
  return `${origin}${path}`;
}
