/**
 * Local-only flag for the Blaxtair OCR demo route. Default off.
 * Mirrors lib/product-devices/flag.ts's pattern — unset/off/false/0 disables.
 *
 * Set NEXT_PUBLIC_BLAXTAIR_DEMO=on in .env.local to view /prototype/blaxtair-demo.
 * This does not affect the real job card or any production flag.
 */

export const BLAXTAIR_DEMO_ENV = "NEXT_PUBLIC_BLAXTAIR_DEMO";

export function isBlaxtairDemoEnabled(raw?: string | null): boolean {
  const v = (raw ?? (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_BLAXTAIR_DEMO : undefined) ?? "")
    .trim()
    .toLowerCase();
  return v === "on" || v === "true" || v === "1" || v === "all";
}
