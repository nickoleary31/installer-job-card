import { getAppDatabase } from "./database.ts";
import { getAppFilesystem } from "./filesystem.ts";
import { getNetworkStatus } from "./network-status.ts";
import { isNativeRuntime, nativePlatform } from "./runtime.ts";
import { getSecureStorage } from "./secure-storage.ts";

/**
 * Phase 2A native-primitives proof. Deliberately isolated from Production
 * data — writes only a small marker string under keys/paths prefixed
 * `phase2a-persistence-proof`, never touches job cards, drafts, photos,
 * companies, projects, or real credentials. Not reachable from any
 * technician-facing route or navigation; exists purely so the native SQLite,
 * Filesystem, and secure-storage plumbing can be exercised end-to-end
 * (including across an app force-close/reopen) before any real feature is
 * built on top of these adapters.
 */

const DB_KEY = "phase2a-persistence-proof";
const FILE_KEY = "phase2a-persistence-proof.txt";
const SECURE_KEY = "phase2a-persistence-proof";

/** Pure — unit-testable without any native runtime. */
export function formatProofMarker(now: Date): string {
  return `proof-${now.toISOString()}`;
}

type PrimitiveOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

function toOutcome<T>(fn: () => Promise<T>): Promise<PrimitiveOutcome<T>> {
  return fn().then(
    (value) => ({ ok: true, value }) as const,
    (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }) as const,
  );
}

export type ProofWriteResult = {
  runtime: { isNative: boolean; platform: string };
  marker: string;
  database: PrimitiveOutcome<null>;
  filesystem: PrimitiveOutcome<null>;
  secureStorage: PrimitiveOutcome<null>;
};

/** Writes the same marker value through all three durable-storage boundaries. */
export async function writeProofMarkers(): Promise<ProofWriteResult> {
  const marker = formatProofMarker(new Date());
  const [database, filesystem, secureStorage] = await Promise.all([
    toOutcome(async () => {
      await getAppDatabase().setSetting(DB_KEY, marker);
      return null;
    }),
    toOutcome(async () => {
      await getAppFilesystem().writeFile(FILE_KEY, new Blob([marker], { type: "text/plain" }));
      return null;
    }),
    toOutcome(async () => {
      await getSecureStorage().set(SECURE_KEY, marker);
      return null;
    }),
  ]);
  return { runtime: { isNative: isNativeRuntime(), platform: nativePlatform() }, marker, database, filesystem, secureStorage };
}

export type ProofReadResult = {
  runtime: { isNative: boolean; platform: string };
  network: { online: boolean };
  database: PrimitiveOutcome<string | null>;
  filesystem: PrimitiveOutcome<string | null>;
  secureStorage: PrimitiveOutcome<string | null>;
};

/**
 * Reads back whatever the three boundaries currently hold for the proof
 * keys. Call this again after a force-close/reopen to prove the values
 * survived a real app restart, not just the current JS session.
 */
export async function readProofMarkers(): Promise<ProofReadResult> {
  const [database, filesystem, secureStorage] = await Promise.all([
    toOutcome(() => getAppDatabase().getSetting(DB_KEY)),
    toOutcome(async () => {
      const blob = await getAppFilesystem().readFile(FILE_KEY);
      return blob ? await blob.text() : null;
    }),
    toOutcome(() => getSecureStorage().get(SECURE_KEY)),
  ]);
  return {
    runtime: { isNative: isNativeRuntime(), platform: nativePlatform() },
    network: { online: getNetworkStatus().isOnline() },
    database,
    filesystem,
    secureStorage,
  };
}

/** Removes the proof markers once a round of testing is done. */
export async function clearProofMarkers(): Promise<void> {
  await Promise.allSettled([
    getAppFilesystem().deleteFile(FILE_KEY),
    getSecureStorage().remove(SECURE_KEY),
    // AppDatabase intentionally has no delete — overwriting with an empty
    // string is sufficient for a proof table that isn't real product data.
    getAppDatabase().setSetting(DB_KEY, ""),
  ]);
}
