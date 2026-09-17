import {
  INSTALLER_DB_FIELD_PACKAGE_STORE,
  INSTALLER_OFFLINE_DB_NAME,
  INSTALLER_OFFLINE_DB_VERSION,
  describeIndexedDbError,
  ensureInstallerOfflineObjectStores,
} from "./installer-offline-db.ts";
import { getNativeActiveProjectsFieldPackage } from "./native/active-projects-field-package.ts";
import { isNativeRuntime } from "./native/runtime.ts";

/**
 * Phase 2B shared field-package boundary: the technician's locally
 * provisioned active-project list. This is a DIFFERENT concept from
 * lib/starter-data-cache.ts, which caches company/project/customer context
 * for the older Companies-first flow and for NewSubmissionForm's offline
 * form-filling needs — it is not populated by ActiveProjectsScreen and
 * stays untouched here. This module is the AUTHORIZED, already-filtered
 * Active Projects result specifically, one snapshot per authenticated user.
 *
 * The UI never issues SQLite/IndexedDB calls directly — it goes through
 * getActiveProjectsFieldPackage(), which branches to a native SQLite
 * implementation (lib/native/active-projects-field-package.ts) or the web
 * IndexedDB implementation below, matching the lib/native/* boundary
 * pattern established in Phase 2A.
 */

export type FieldPackageProject = {
  projectId: string;
  companyId: string;
  companyName: string;
  projectName: string;
  displayCustomerName: string;
  displayLocation: string;
  completedSubmissionCount: number;
  active: boolean;
};

export type ActiveProjectsSnapshot = {
  userId: string;
  syncedAt: string;
  schemaVersion: number;
  projects: FieldPackageProject[];
};

export type SnapshotMetadata = {
  userId: string;
  syncedAt: string;
  schemaVersion: number;
  projectCount: number;
} | null;

export interface ActiveProjectsFieldPackage {
  /**
   * Resolves with the syncedAt timestamp actually committed in the same
   * atomic transaction that wrote the package — never a client-side
   * approximation — so a caller only ever learns a syncedAt that
   * corresponds to a package genuinely persisted on this device. Rejects,
   * leaving the previous package fully intact, if the transaction fails.
   */
  saveActiveProjectsSnapshot(userId: string, projects: readonly FieldPackageProject[]): Promise<{ syncedAt: string }>;
  loadActiveProjectsSnapshot(userId: string): Promise<ActiveProjectsSnapshot | null>;
  getSnapshotMetadata(userId: string): Promise<SnapshotMetadata>;
  clearSnapshotForUser(userId: string): Promise<void>;
}

const CURRENT_SCHEMA_VERSION = 1;
const STORE_NAME = INSTALLER_DB_FIELD_PACKAGE_STORE;

function openFieldPackageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB unavailable: window.indexedDB is missing (SSR, unsupported browser, or storage blocked)."));
      return;
    }
    const request = window.indexedDB.open(INSTALLER_OFFLINE_DB_NAME, INSTALLER_OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => ensureInstallerOfflineObjectStores(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(describeIndexedDbError("IndexedDB open failed (field package)", request.error));
  });
}

/**
 * One record per user holding the full snapshot — a single `store.put()`
 * replaces it atomically (IndexedDB transactions are all-or-nothing), the
 * same guarantee the native implementation gets from `executeSet(set,
 * true)` over normalized rows. Mirrors lib/starter-data-cache.ts's proven
 * userId-keyed pattern rather than inventing a new browser database.
 */
class WebIndexedDbFieldPackage implements ActiveProjectsFieldPackage {
  async saveActiveProjectsSnapshot(userId: string, projects: readonly FieldPackageProject[]): Promise<{ syncedAt: string }> {
    const db = await openFieldPackageDb();
    const syncedAt = new Date().toISOString();
    const snapshot: ActiveProjectsSnapshot = {
      userId,
      syncedAt,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projects: [...projects],
    };
    try {
      // A single put() inside one transaction — IndexedDB transactions are
      // all-or-nothing, so onerror/onabort leaves the previous record (if
      // any) completely untouched; the resolved syncedAt below is only ever
      // reached once oncomplete confirms the write actually committed.
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(snapshot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(describeIndexedDbError("IndexedDB write failed (field package save)", tx.error));
        tx.onabort = () => reject(new Error("IndexedDB write failed: field package save transaction aborted."));
      });
      return { syncedAt };
    } finally {
      db.close();
    }
  }

  async loadActiveProjectsSnapshot(userId: string): Promise<ActiveProjectsSnapshot | null> {
    const db = await openFieldPackageDb();
    try {
      return await new Promise<ActiveProjectsSnapshot | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(userId);
        req.onsuccess = () => resolve((req.result as ActiveProjectsSnapshot | undefined) ?? null);
        req.onerror = () => reject(describeIndexedDbError("IndexedDB read failed (field package load)", req.error));
      });
    } finally {
      db.close();
    }
  }

  async getSnapshotMetadata(userId: string): Promise<SnapshotMetadata> {
    const snapshot = await this.loadActiveProjectsSnapshot(userId);
    if (!snapshot) return null;
    return {
      userId: snapshot.userId,
      syncedAt: snapshot.syncedAt,
      schemaVersion: snapshot.schemaVersion,
      projectCount: snapshot.projects.length,
    };
  }

  async clearSnapshotForUser(userId: string): Promise<void> {
    const db = await openFieldPackageDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(userId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(describeIndexedDbError("IndexedDB delete failed (field package clear)", tx.error));
      });
    } finally {
      db.close();
    }
  }
}

const webFieldPackageSingleton = new WebIndexedDbFieldPackage();

/**
 * lib/native/active-projects-field-package.ts has no top-level import of
 * @capacitor-community/sqlite itself (only inside its methods, via
 * lib/native/database.ts's getNativeSqliteConnection()), so it's safe to
 * import statically here — same as every other lib/native/* boundary
 * factory (getAppDatabase(), getAppFilesystem(), etc.).
 */
export function getActiveProjectsFieldPackage(): ActiveProjectsFieldPackage {
  return isNativeRuntime() ? getNativeActiveProjectsFieldPackage() : webFieldPackageSingleton;
}

/** UI view-model shape shared with components/ActiveProjectsScreen.tsx. */
export type ActiveProjectCard = {
  id: string;
  companyId: string;
  projectName: string;
  displayCustomerName: string;
  displayLocation: string;
  completedSubmissionCount: number;
};

export type CompanyGroup = {
  companyId: string;
  companyName: string;
  projects: ActiveProjectCard[];
};

/** Pure — flattens the screen's grouped view model into storable rows. */
export function toFieldPackageProjects(groups: readonly CompanyGroup[]): FieldPackageProject[] {
  return groups.flatMap((group) =>
    group.projects.map((project) => ({
      projectId: project.id,
      companyId: group.companyId,
      companyName: group.companyName,
      projectName: project.projectName,
      displayCustomerName: project.displayCustomerName,
      displayLocation: project.displayLocation,
      completedSubmissionCount: project.completedSubmissionCount,
      active: true, // ActiveProjectsScreen only ever queries active=true projects
    })),
  );
}

/**
 * Pure — rebuilds the screen's grouped view model from stored rows, for the
 * offline-cached display path. Sorted the same way the online query is
 * (companies by name, projects by name within each) so the cached view
 * doesn't visibly reorder once a fresh online load succeeds.
 */
export function fromFieldPackageProjects(projects: readonly FieldPackageProject[]): CompanyGroup[] {
  const groupsByCompany = new Map<string, CompanyGroup>();
  for (const project of projects) {
    if (!project.active) continue;
    let group = groupsByCompany.get(project.companyId);
    if (!group) {
      group = { companyId: project.companyId, companyName: project.companyName, projects: [] };
      groupsByCompany.set(project.companyId, group);
    }
    group.projects.push({
      id: project.projectId,
      companyId: project.companyId,
      projectName: project.projectName,
      displayCustomerName: project.displayCustomerName,
      displayLocation: project.displayLocation,
      completedSubmissionCount: project.completedSubmissionCount,
    });
  }
  const groups = [...groupsByCompany.values()];
  for (const group of groups) {
    group.projects.sort((a, b) => a.projectName.localeCompare(b.projectName));
  }
  groups.sort((a, b) => a.companyName.localeCompare(b.companyName));
  return groups;
}

export type ActiveProjectsLoadOutcome =
  | { kind: "online"; groups: CompanyGroup[] }
  | { kind: "offline-cached"; groups: CompanyGroup[]; syncedAt: string }
  | { kind: "unavailable"; error: string };

/**
 * Pure decision logic for the Active Projects load policy — extracted
 * specifically so it's unit-testable without mocking Supabase/IndexedDB/
 * SQLite (same rationale as lib/active-projects-visibility.ts). Encodes:
 * a successful remote load always wins and is shown as "online" (the
 * cached snapshot is never consulted, let alone shown, when the network
 * succeeds); a failed remote load falls back to the cached snapshot if one
 * exists, explicitly tagged "offline-cached" rather than presented as
 * fresh; with no cache, an honest "unavailable" outcome carrying the
 * original error. A failure can never destroy or hide a good cache because
 * this function only decides what to DISPLAY — persisting a snapshot is a
 * separate call this function has no path to trigger.
 */
export function resolveActiveProjectsLoadOutcome(params: {
  remote: { ok: true; groups: CompanyGroup[] } | { ok: false; error: string };
  cachedSnapshot: ActiveProjectsSnapshot | null;
}): ActiveProjectsLoadOutcome {
  if (params.remote.ok) {
    return { kind: "online", groups: params.remote.groups };
  }
  if (params.cachedSnapshot) {
    return {
      kind: "offline-cached",
      groups: fromFieldPackageProjects(params.cachedSnapshot.projects),
      syncedAt: params.cachedSnapshot.syncedAt,
    };
  }
  return { kind: "unavailable", error: params.remote.error };
}
