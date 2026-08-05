/**
 * Multi-draft local store — replaces the old single-slot blaxtair-ocr-demo-draft-v1 key.
 * Supports realistic "you already have a draft for this" detection, which a single draft
 * slot can't represent (there's nothing else to match against).
 *
 * Single-browser only. Cross-technician draft coordination is NOT simulated here — see
 * docs/Blaxtair_Demo_Duplicate_Detection.md for why, and the production plan.
 */

import { collectJobCardDeviceKeys, collectJobCardPhotoFingerprints, type BlaxtairDemoJobCard } from "./blaxtair-job-card.ts";
import { normalizeDeviceKey } from "./label-scan/blaxtair-draft.ts";

const DRAFTS_KEY = "blaxtair-demo-drafts-v1";

export function upsertDraft(drafts: BlaxtairDemoJobCard[], draft: BlaxtairDemoJobCard): BlaxtairDemoJobCard[] {
  const idx = drafts.findIndex((d) => d.id === draft.id);
  if (idx < 0) return [...drafts, draft];
  const next = drafts.slice();
  next[idx] = draft;
  return next;
}

export function removeDraft(drafts: BlaxtairDemoJobCard[], id: string): BlaxtairDemoJobCard[] {
  return drafts.filter((d) => d.id !== id);
}

/**
 * Does this fingerprint or device key already appear in a DIFFERENT saved draft? Used to prompt
 * "continue previous draft or discard and continue here" before letting new content land in the
 * current draft.
 */
export function findMatchingOtherDraft(
  drafts: BlaxtairDemoJobCard[],
  args: { excludeId: string; fingerprint?: string; partNumber?: string; serialNumber?: string },
): BlaxtairDemoJobCard | null {
  const fp = args.fingerprint?.trim();
  const deviceKey =
    args.serialNumber?.trim() && args.partNumber !== undefined
      ? normalizeDeviceKey(args.partNumber, args.serialNumber)
      : null;
  if (!fp && !deviceKey) return null;

  return (
    drafts.find((d) => {
      if (d.id === args.excludeId) return false;
      if (fp && collectJobCardPhotoFingerprints(d).some((f) => f.fingerprint === fp)) return true;
      if (deviceKey) {
        return collectJobCardDeviceKeys(d).some(
          (k) => normalizeDeviceKey(k.partNumber, k.serialNumber) === deviceKey,
        );
      }
      return false;
    }) ?? null
  );
}

export function loadDrafts(): BlaxtairDemoJobCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BlaxtairDemoJobCard[]) : [];
  } catch {
    return [];
  }
}

export function saveDrafts(drafts: BlaxtairDemoJobCard[]): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: true };
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    return { ok: true };
  } catch {
    return { ok: false, error: "Local storage is full — the draft could not be saved on this device." };
  }
}
