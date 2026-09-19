/**
 * Single IndexedDB database shared by starter snapshot cache + offline job drafts
 * + the Phase 2B active-projects field package + the Phase 2D project work
 * package + the Phase 2E company product definitions package. All open()
 * calls must use the same name/version so onupgradeneeded creates every
 * store once.
 */
export const INSTALLER_OFFLINE_DB_NAME = "installer-sheetz-offline";
export const INSTALLER_OFFLINE_DB_VERSION = 6;

export const INSTALLER_DB_STARTER_STORE = "starter-data-cache";
export const INSTALLER_DB_OFFLINE_DRAFTS_STORE = "job-card-offline-drafts";
export const INSTALLER_DB_FIELD_PACKAGE_STORE = "field-package-active-projects";
/** Phase 2D — one record per (userId, projectId); see lib/project-work-package.ts. */
export const INSTALLER_DB_PROJECT_WORK_PACKAGE_STORE = "field-package-project-detail";
/** Phase 2E — one record per companyId (shared, not user-scoped); see lib/product-config/company-product-definitions.ts. */
export const INSTALLER_DB_COMPANY_PRODUCT_DEFINITIONS_STORE = "field-package-company-product-definitions";

export function ensureInstallerOfflineObjectStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(INSTALLER_DB_STARTER_STORE)) {
    db.createObjectStore(INSTALLER_DB_STARTER_STORE, { keyPath: "userId" });
  }
  if (!db.objectStoreNames.contains(INSTALLER_DB_OFFLINE_DRAFTS_STORE)) {
    const store = db.createObjectStore(INSTALLER_DB_OFFLINE_DRAFTS_STORE, { keyPath: "offlineDraftId" });
    store.createIndex("savedAt", "savedAt", { unique: false });
  }
  if (!db.objectStoreNames.contains(INSTALLER_DB_FIELD_PACKAGE_STORE)) {
    db.createObjectStore(INSTALLER_DB_FIELD_PACKAGE_STORE, { keyPath: "userId" });
  }
  if (!db.objectStoreNames.contains(INSTALLER_DB_PROJECT_WORK_PACKAGE_STORE)) {
    const store = db.createObjectStore(INSTALLER_DB_PROJECT_WORK_PACKAGE_STORE, { keyPath: ["userId", "projectId"] });
    // Needed to enumerate/prune one user's packages during bulk provisioning
    // (see lib/project-work-package.ts's provisionProjectWorkPackages())
    // without a userId-prefixed compound-key range scan.
    store.createIndex("userId", "userId", { unique: false });
  }
  if (!db.objectStoreNames.contains(INSTALLER_DB_COMPANY_PRODUCT_DEFINITIONS_STORE)) {
    db.createObjectStore(INSTALLER_DB_COMPANY_PRODUCT_DEFINITIONS_STORE, { keyPath: "companyId" });
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
