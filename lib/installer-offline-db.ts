/**
 * Single IndexedDB database shared by starter snapshot cache + offline job drafts.
 * All open() calls must use the same name/version so onupgradeneeded creates every store once.
 */
export const INSTALLER_OFFLINE_DB_NAME = "installer-sheetz-offline";
export const INSTALLER_OFFLINE_DB_VERSION = 3;

export const INSTALLER_DB_STARTER_STORE = "starter-data-cache";
export const INSTALLER_DB_OFFLINE_DRAFTS_STORE = "job-card-offline-drafts";

export function ensureInstallerOfflineObjectStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(INSTALLER_DB_STARTER_STORE)) {
    db.createObjectStore(INSTALLER_DB_STARTER_STORE, { keyPath: "userId" });
  }
  if (!db.objectStoreNames.contains(INSTALLER_DB_OFFLINE_DRAFTS_STORE)) {
    const store = db.createObjectStore(INSTALLER_DB_OFFLINE_DRAFTS_STORE, { keyPath: "offlineDraftId" });
    store.createIndex("savedAt", "savedAt", { unique: false });
  }
}

export function describeIndexedDbError(context: string, err: unknown): Error {
  if (err instanceof DOMException) {
    return new Error(`${context}: ${err.name}: ${err.message}`);
  }
  if (err instanceof Error) {
    return new Error(`${context}: ${err.name}: ${err.message}`);
  }
  return new Error(`${context}: ${String(err)}`);
}
