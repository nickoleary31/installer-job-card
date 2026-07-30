/**
 * Product configuration JSON helpers (pairing fields + forward-compatible unknown keys).
 */

import type { ProductConfiguration } from "./types.ts";

export type ProductConfigurationRecord = ProductConfiguration & Record<string, unknown>;

/**
 * Validate known pairing fields while preserving any other JSON keys.
 * Does not strip unknown keys (forward-compatible for sections/fields/OCR later).
 */
export function parseProductConfiguration(raw: unknown): ProductConfigurationRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const preserved: ProductConfigurationRecord = { ...(raw as Record<string, unknown>) };

  if ("allowedAdditionalProductKeys" in preserved) {
    const keys = preserved.allowedAdditionalProductKeys;
    if (Array.isArray(keys)) {
      preserved.allowedAdditionalProductKeys = keys.map((k) => String(k).trim()).filter(Boolean);
    } else if (keys === null || keys === undefined) {
      delete preserved.allowedAdditionalProductKeys;
    } else {
      delete preserved.allowedAdditionalProductKeys;
    }
  }

  if ("maxAdditionalCount" in preserved) {
    const max = preserved.maxAdditionalCount;
    if (typeof max === "number" && Number.isFinite(max)) {
      preserved.maxAdditionalCount = Math.max(0, Math.floor(max));
    } else if (max === null || max === undefined) {
      delete preserved.maxAdditionalCount;
    } else {
      const n = Number(max);
      if (Number.isFinite(n)) {
        preserved.maxAdditionalCount = Math.max(0, Math.floor(n));
      } else {
        delete preserved.maxAdditionalCount;
      }
    }
  }

  return preserved;
}

/** Known Phase 1 pairing fields only (for UI editors that do not round-trip unknown keys). */
export function pairingFieldsFromConfiguration(
  config: ProductConfiguration | Record<string, unknown> | null | undefined,
): ProductConfiguration {
  const parsed = parseProductConfiguration(config ?? {});
  return {
    ...(parsed.allowedAdditionalProductKeys
      ? { allowedAdditionalProductKeys: parsed.allowedAdditionalProductKeys }
      : {}),
    ...(parsed.maxAdditionalCount !== undefined
      ? { maxAdditionalCount: parsed.maxAdditionalCount }
      : {}),
  };
}

/**
 * Merge an editor's pairing fields over an existing configuration, keeping unknown keys
 * from the existing row (and from the editor payload if present).
 */
export function mergeProductConfiguration(args: {
  existing?: unknown;
  incoming?: unknown;
}): ProductConfigurationRecord {
  const existing = parseProductConfiguration(args.existing ?? {});
  const incoming = parseProductConfiguration(args.incoming ?? {});
  return {
    ...existing,
    ...incoming,
  };
}
