/**
 * Local completed-submissions store — every revision is its own record, chained by
 * (originalSubmissionId, supersedes). "Current" is always DERIVED (highest revisionNumber in
 * the chain), never a stored flag — same event-log-over-flag philosophy already used for
 * device installation history (lib/prototype/label-scan/blaxtair-install-registry.ts).
 *
 * Single-browser only — see docs/Blaxtair_Demo_Duplicate_Detection.md for the production plan.
 */

import { collectJobCardDeviceKeys, collectJobCardPhotoFingerprints, type BlaxtairDemoJobCard } from "./blaxtair-job-card.ts";
import { normalizeDeviceKey } from "./label-scan/blaxtair-draft.ts";

const SUBMISSIONS_KEY = "blaxtair-demo-submissions-v1";

function chainRootId(jobCard: BlaxtairDemoJobCard): string {
  return jobCard.revision.originalSubmissionId ?? jobCard.id;
}

/** Every revision (original + corrections) that belongs to the same chain as jobCardOrId. */
export function getRevisionChain(submissions: BlaxtairDemoJobCard[], jobCardOrId: BlaxtairDemoJobCard | string): BlaxtairDemoJobCard[] {
  const root = typeof jobCardOrId === "string" ? (submissions.find((s) => s.id === jobCardOrId) ?? null) : jobCardOrId;
  if (!root) return [];
  const wantedRoot = chainRootId(root);
  return submissions
    .filter((s) => chainRootId(s) === wantedRoot)
    .sort((a, b) => a.revision.revisionNumber - b.revision.revisionNumber);
}

/** The current (highest revisionNumber) record in a chain — never a stored "isCurrent" flag. */
export function getCurrentRevision(submissions: BlaxtairDemoJobCard[], jobCardOrId: BlaxtairDemoJobCard | string): BlaxtairDemoJobCard | null {
  const chain = getRevisionChain(submissions, jobCardOrId);
  return chain[chain.length - 1] ?? null;
}

export function isSuperseded(submissions: BlaxtairDemoJobCard[], jobCard: BlaxtairDemoJobCard): boolean {
  const current = getCurrentRevision(submissions, jobCard);
  return current != null && current.id !== jobCard.id;
}

/** All ids in a chain — used to EXCLUDE same-chain matches from cross-job duplicate blocks. */
export function getRevisionChainIds(submissions: BlaxtairDemoJobCard[], jobCardOrId: BlaxtairDemoJobCard | string): string[] {
  return getRevisionChain(submissions, jobCardOrId).map((s) => s.id);
}

/**
 * Cross-submission photo reuse, excluding the given chain ids (same-chain reuse is allowed —
 * it's the same installation's evidence, not new evidence passed off as something else).
 */
export function findCrossSubmissionPhotoReuse(
  submissions: BlaxtairDemoJobCard[],
  fingerprint: string,
  excludeChainIds: string[],
): BlaxtairDemoJobCard | null {
  const target = fingerprint.trim();
  if (!target) return null;
  return (
    submissions.find(
      (s) =>
        !excludeChainIds.includes(s.id) &&
        collectJobCardPhotoFingerprints(s).some((f) => f.fingerprint === target),
    ) ?? null
  );
}

/** Cross-submission device reuse (part+serial), excluding the given chain ids. */
export function findCrossSubmissionDeviceReuse(
  submissions: BlaxtairDemoJobCard[],
  partNumber: string,
  serialNumber: string,
  excludeChainIds: string[],
): BlaxtairDemoJobCard | null {
  if (!serialNumber.trim()) return null;
  const key = normalizeDeviceKey(partNumber, serialNumber);
  return (
    submissions.find(
      (s) =>
        !excludeChainIds.includes(s.id) &&
        collectJobCardDeviceKeys(s).some((k) => normalizeDeviceKey(k.partNumber, k.serialNumber) === key),
    ) ?? null
  );
}

/** Build a new DRAFT that starts a corrected revision of `original` (the current revision). */
export function createCorrectedRevision(
  original: BlaxtairDemoJobCard,
  args: { newId: string; reason: string; revisedBy: string; nowIso?: string },
): BlaxtairDemoJobCard {
  const now = args.nowIso ?? new Date().toISOString();
  return {
    ...original,
    id: args.newId,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    currentStage: "review",
    revision: {
      originalSubmissionId: original.revision.originalSubmissionId ?? original.id,
      revisionNumber: original.revision.revisionNumber + 1,
      supersedes: original.id,
      reason: args.reason,
      revisedBy: args.revisedBy,
      revisedAt: now,
      changedFields: [],
    },
  };
}

export function loadSubmissions(): BlaxtairDemoJobCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUBMISSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BlaxtairDemoJobCard[]) : [];
  } catch {
    return [];
  }
}

export function saveSubmissions(submissions: BlaxtairDemoJobCard[]): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: true };
  try {
    window.localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(submissions));
    return { ok: true };
  } catch {
    return { ok: false, error: "Local storage is full — the submission could not be saved on this device." };
  }
}
