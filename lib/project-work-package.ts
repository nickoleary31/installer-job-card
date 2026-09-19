import {
  INSTALLER_DB_PROJECT_WORK_PACKAGE_STORE,
  INSTALLER_OFFLINE_DB_NAME,
  INSTALLER_OFFLINE_DB_VERSION,
  describeIndexedDbError,
  ensureInstallerOfflineObjectStores,
} from "./installer-offline-db.ts";
import { getNativeProjectWorkPackage } from "./native/project-work-package.ts";
import { isNativeRuntime } from "./native/runtime.ts";

/**
 * Phase 2D — the locally provisioned record a technician needs to open
 * Project Detail and understand a specific project WITHOUT server access.
 * Deliberately narrower than the full (online) ProjectDetailScreen: no
 * expenses (a separate subsystem needing Supabase Storage photo uploads,
 * out of scope), no Site Info contact/license/WiFi/notes fields (reference
 * detail, not required to view identity or start a submission). Scoped by
 * BOTH userId and projectId — see saveProjectWorkPackage()'s contract.
 *
 * Zoho fields are optional display enrichment copied in during a
 * successful ONLINE sync (see ProjectDetailScreen's own Zoho fetch effect)
 * — the offline path never calls Zoho itself; a package synced before the
 * project was linked (or never re-synced since) simply omits them.
 *
 * IMPORTANT — `zohoLinked: false` is NOT an authoritative "this project is
 * confirmed not linked to Zoho" claim. It also covers "no cached Zoho
 * enrichment is available yet" — the state of every package written by
 * buildProvisionedProjectWorkPackages()'s bulk provisioning path (see that
 * function's own doc), which deliberately never queries Zoho and so cannot
 * know either way. Both cases render identically today (the "Linked to
 * Zoho FSM" banner is simply omitted — see ProjectDetailScreen), which is
 * correct precisely because omission asserts nothing. Do NOT add UI/
 * business logic elsewhere that reads `zohoLinked === false` as "confirmed
 * not linked" without first distinguishing "never enriched" from "checked,
 * genuinely unlinked" — this type does not carry that distinction.
 */
export type ProjectWorkPackage = {
  userId: string;
  projectId: string;
  companyId: string;
  companyName: string;
  projectName: string;
  /** Site name for a Zoho-linked project, or the legacy "Customer" name otherwise. */
  customerName: string;
  /** null when there is no linked Customer Account (mirrors ProjectDetailScreen's "—" case). */
  customerAccountName: string | null;
  location: string;
  /**
   * true only once an online Project Detail visit's own Zoho fetch
   * confirmed a link. false covers BOTH "confirmed not linked" and "not
   * yet enriched" (every proactively provisioned package's starting
   * value) — see this type's own doc comment above. Never treat false as
   * proof of non-linkage.
   */
  zohoLinked: boolean;
  zohoWorkOrderNumber: string | null;
  zohoServiceAppointmentNumber: string | null;
  zohoSummary: string | null;
  schemaVersion: number;
  syncedAt: string;
};

export type ProjectWorkPackageInput = Omit<ProjectWorkPackage, "schemaVersion" | "syncedAt">;

export interface ProjectWorkPackageRepository {
  /**
   * Resolves with the syncedAt actually committed — never a client-side
   * approximation. Rejects, leaving any previous package for this exact
   * (userId, projectId) fully intact, if the write fails.
   */
  saveProjectWorkPackage(pkg: ProjectWorkPackageInput): Promise<{ syncedAt: string }>;
  loadProjectWorkPackage(userId: string, projectId: string): Promise<ProjectWorkPackage | null>;
  clearProjectWorkPackage(userId: string, projectId: string): Promise<void>;
  /**
   * Phase 2D.1 — the proactive-provisioning write: called once, right after
   * a successful Active Projects sync, with the FULL currently-authorized
   * project set for this user (never per-project). Atomically (1) prunes
   * any existing package for this user whose projectId is NOT in that set
   * (a project the technician can no longer see must stop being reachable
   * offline), and (2) upserts every authorized package WITHOUT clobbering
   * zoho_* fields an earlier Project Detail online visit already
   * populated (see the native/web implementations' own upsert SQL/merge
   * logic). Rejects, leaving every previous package — stale or not —
   * completely untouched, if the write fails partway; a caller must never
   * treat a rejection here as "some packages are now gone."
   */
  provisionProjectWorkPackages(userId: string, packages: readonly ProjectWorkPackageInput[]): Promise<{ syncedAt: string }>;
}

const CURRENT_SCHEMA_VERSION = 1;
const STORE_NAME = INSTALLER_DB_PROJECT_WORK_PACKAGE_STORE;

function openProjectWorkPackageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB unavailable: window.indexedDB is missing (SSR, unsupported browser, or storage blocked)."));
      return;
    }
    const request = window.indexedDB.open(INSTALLER_OFFLINE_DB_NAME, INSTALLER_OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => ensureInstallerOfflineObjectStores(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(describeIndexedDbError("IndexedDB open failed (project work package)", request.error));
  });
}

/** Mirrors lib/active-projects-field-package.ts's WebIndexedDbFieldPackage — one record per (userId, projectId), a single put() is atomic. */
class WebIndexedDbProjectWorkPackage implements ProjectWorkPackageRepository {
  async saveProjectWorkPackage(pkg: ProjectWorkPackageInput): Promise<{ syncedAt: string }> {
    const db = await openProjectWorkPackageDb();
    const syncedAt = new Date().toISOString();
    const record: ProjectWorkPackage = { ...pkg, schemaVersion: CURRENT_SCHEMA_VERSION, syncedAt };
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(describeIndexedDbError("IndexedDB write failed (project work package save)", tx.error));
        tx.onabort = () => reject(new Error("IndexedDB write failed: project work package save transaction aborted."));
      });
      return { syncedAt };
    } finally {
      db.close();
    }
  }

  async loadProjectWorkPackage(userId: string, projectId: string): Promise<ProjectWorkPackage | null> {
    const db = await openProjectWorkPackageDb();
    try {
      return await new Promise<ProjectWorkPackage | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get([userId, projectId]);
        req.onsuccess = () => resolve((req.result as ProjectWorkPackage | undefined) ?? null);
        req.onerror = () => reject(describeIndexedDbError("IndexedDB read failed (project work package load)", req.error));
      });
    } finally {
      db.close();
    }
  }

  async clearProjectWorkPackage(userId: string, projectId: string): Promise<void> {
    const db = await openProjectWorkPackageDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete([userId, projectId]);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(describeIndexedDbError("IndexedDB delete failed (project work package clear)", tx.error));
      });
    } finally {
      db.close();
    }
  }

  /**
   * All within ONE readwrite transaction (IndexedDB auto-commits only once
   * no further request is pending, so chaining get()/put()/delete() calls
   * from within each other's onsuccess — as below — keeps everything
   * atomic without an explicit BEGIN/COMMIT): first prune this user's
   * packages no longer in the authorized set via the userId index, then
   * for each authorized package, read whatever's already stored for that
   * exact key (if anything) and preserve ITS zoho_* fields rather than
   * resetting them to the caller's nulls — mirrors the native
   * implementation's ON CONFLICT column-omission trick, just expressed as
   * an explicit read-merge-write since IndexedDB has no partial upsert.
   */
  async provisionProjectWorkPackages(userId: string, packages: readonly ProjectWorkPackageInput[]): Promise<{ syncedAt: string }> {
    const db = await openProjectWorkPackageDb();
    const syncedAt = new Date().toISOString();
    const authorizedIds = new Set(packages.map((p) => p.projectId));
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(describeIndexedDbError("IndexedDB write failed (project work package provisioning)", tx.error));
        tx.onabort = () => reject(new Error("IndexedDB write failed: project work package provisioning transaction aborted."));

        const cursorReq = store.index("userId").openCursor(IDBKeyRange.only(userId));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const existing = cursor.value as ProjectWorkPackage;
            if (!authorizedIds.has(existing.projectId)) cursor.delete();
            cursor.continue();
            return;
          }
          // Prune pass finished — upsert every authorized package, preserving existing Zoho enrichment.
          for (const pkg of packages) {
            const getReq = store.get([userId, pkg.projectId]);
            getReq.onsuccess = () => {
              const existing = getReq.result as ProjectWorkPackage | undefined;
              const record: ProjectWorkPackage = {
                ...pkg,
                zohoLinked: existing?.zohoLinked ?? pkg.zohoLinked,
                zohoWorkOrderNumber: existing?.zohoWorkOrderNumber ?? pkg.zohoWorkOrderNumber,
                zohoServiceAppointmentNumber: existing?.zohoServiceAppointmentNumber ?? pkg.zohoServiceAppointmentNumber,
                zohoSummary: existing?.zohoSummary ?? pkg.zohoSummary,
                schemaVersion: CURRENT_SCHEMA_VERSION,
                syncedAt,
              };
              store.put(record);
            };
          }
        };
      });
      return { syncedAt };
    } finally {
      db.close();
    }
  }
}

const webProjectWorkPackageSingleton = new WebIndexedDbProjectWorkPackage();

/**
 * lib/native/project-work-package.ts has no top-level import of
 * @capacitor-community/sqlite itself (only inside its methods, via
 * lib/native/database.ts's getNativeSqliteConnection()), so it's safe to
 * import statically here — same as every other lib/native/* boundary
 * factory.
 */
export function getProjectWorkPackageRepository(): ProjectWorkPackageRepository {
  return isNativeRuntime() ? getNativeProjectWorkPackage() : webProjectWorkPackageSingleton;
}

export type ProjectDetailLoadOutcome =
  | { kind: "online"; package: ProjectWorkPackageInput }
  | { kind: "offline-cached"; package: ProjectWorkPackage }
  | { kind: "unavailable"; error: string };

/**
 * Pure decision logic for the Project Detail load policy — mirrors
 * lib/active-projects-field-package.ts's resolveActiveProjectsLoadOutcome()
 * exactly: a successful remote load always wins and is shown as "online"
 * (the cached package is never consulted when the network succeeds); a
 * failed remote load falls back to the cached package if one exists for
 * this exact (userId, projectId), explicitly tagged "offline-cached"
 * rather than presented as fresh; with no cache, an honest "unavailable"
 * outcome carrying the original error. This function only decides what to
 * DISPLAY — persisting a package is a separate call this function has no
 * path to trigger, so a failed remote load can never destroy a good cache.
 */
export function resolveProjectDetailLoadOutcome(params: {
  remote: { ok: true; package: ProjectWorkPackageInput } | { ok: false; error: string };
  cachedPackage: ProjectWorkPackage | null;
}): ProjectDetailLoadOutcome {
  if (params.remote.ok) {
    return { kind: "online", package: params.remote.package };
  }
  if (params.cachedPackage) {
    return { kind: "offline-cached", package: params.cachedPackage };
  }
  return { kind: "unavailable", error: params.remote.error };
}

/** The subset of ActiveProjectsScreen's already-fetched per-project row data buildProvisionedProjectWorkPackages() needs — see that function's doc. */
export type ActiveProjectForProvisioning = {
  projectId: string;
  companyId: string;
  companyName: string;
  projectName: string;
  customerName: string;
  /** null when the project has no linked customer/customer_account_id at all. */
  customerAccountId: string | null;
  location: string;
};

/**
 * Pure — Phase 2D.1's proactive-provisioning mapper: builds the minimum
 * ProjectWorkPackageInput for EVERY currently-authorized project from data
 * ActiveProjectsScreen's existing bulk queries already fetched (companies,
 * projects+customers join), plus one small additional bulk
 * customer_accounts lookup this function does not perform itself — see
 * ActiveProjectsScreen.tsx's own call site for where that query is built.
 * No Zoho request is made or implied here: every package starts with
 * zohoLinked:false and null WO#/SA#/summary, matching the product
 * decision that Zoho enrichment is optional display data an actual
 * Project Detail online visit fills in later, never a bulk-sync
 * dependency (which would mean one Zoho request per project). Unit-
 * testable without any Supabase/SQLite/IndexedDB I/O — see
 * project-work-package.test.ts.
 */
export function buildProvisionedProjectWorkPackages(
  userId: string,
  projects: readonly ActiveProjectForProvisioning[],
  customerAccountNamesById: Readonly<Record<string, string>>,
): ProjectWorkPackageInput[] {
  return projects.map((p) => ({
    userId,
    projectId: p.projectId,
    companyId: p.companyId,
    companyName: p.companyName,
    projectName: p.projectName,
    customerName: p.customerName,
    customerAccountName: p.customerAccountId ? (customerAccountNamesById[p.customerAccountId] ?? null) : null,
    location: p.location,
    zohoLinked: false,
    zohoWorkOrderNumber: null,
    zohoServiceAppointmentNumber: null,
    zohoSummary: null,
  }));
}
