/**
 * Canonical JSON hashing shared by every contentHash producer (see lib/zoho-fsm/evidence.ts and
 * app/api/integrations/zoho-fsm/evidence/pdf/route.ts) — the same stored submission payload must
 * always hash to the same value regardless of how its object keys happen to come back from
 * Postgres/JSON parsing, so every caller runs through this one helper rather than hashing
 * JSON.stringify(payload) directly.
 */
import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize(record[key]);
    }
    return result;
  }
  return value;
}

/**
 * Deterministic JSON serialization: object keys sorted recursively at every depth, array element
 * order always preserved, primitive values passed through unchanged.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 hex digest of the canonical JSON representation of `value`. */
export function computeContentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}
