/**
 * Runtime product overlay — DEPRECATED for cross-request use.
 *
 * Prefer {@link buildProductLookupMaps} / {@link ProductDisplayContext} passed explicitly
 * into email, review, and submission helpers.
 *
 * Kept as a no-op-safe shim for any residual callers; the hybrid resolver no longer sets it.
 */

type OverlayEntry = {
  displayLabel: string;
  baseFormId: string;
};

const overlayBySectionKey = new Map<string, OverlayEntry>();

/** @deprecated Prefer buildProductLookupMaps + explicit ProductDisplayContext. */
export function setProductLabelOverlay(
  entries: ReadonlyArray<{ sectionKey: string; displayLabel: string; baseFormId?: string }>,
): void {
  overlayBySectionKey.clear();
  for (const entry of entries) {
    const key = entry.sectionKey.trim();
    const label = entry.displayLabel.trim();
    if (!key || !label) continue;
    overlayBySectionKey.set(key, {
      displayLabel: label,
      baseFormId: (entry.baseFormId || "").trim(),
    });
  }
}

export function clearProductLabelOverlay(): void {
  overlayBySectionKey.clear();
}

export function getOverlayProductLabel(sectionKey: string | null | undefined): string | undefined {
  const key = (sectionKey || "").trim();
  if (!key) return undefined;
  return overlayBySectionKey.get(key)?.displayLabel;
}

export function getOverlayBaseFormId(sectionKey: string | null | undefined): string | undefined {
  const key = (sectionKey || "").trim();
  if (!key) return undefined;
  const base = overlayBySectionKey.get(key)?.baseFormId;
  return base || undefined;
}
