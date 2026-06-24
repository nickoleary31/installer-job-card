import {
  INSTALLER_DB_OFFLINE_DRAFTS_STORE,
  INSTALLER_OFFLINE_DB_NAME,
  INSTALLER_OFFLINE_DB_VERSION,
  describeIndexedDbError,
  ensureInstallerOfflineObjectStores,
} from "@/lib/installer-offline-db";

export type OfflineJobCardDraftRecord<TDraftData> = {
  offlineDraftId: string;
  submissionId: string;
  savedAt: string;
  selectedSections: string[];
  data: TDraftData;
  photoRestoreSupported: boolean;
  companyId?: string;
  projectId?: string;
  companyName?: string;
  projectName?: string;
  customer?: string;
  location?: string;
  unitNumber?: string;
  workOrderNumber?: string;
  /** @deprecated Legacy rows — prefer workOrderNumber */
  workOrder?: string;
  /** @deprecated Legacy rows — listing uses selectedSections */
  hardwareSummary?: string;
  attachments?: {
    ppdJsonFile?: {
      name: string;
      type: string;
      lastModified: number;
      data: Blob;
    };
  };
};

/** Set before navigating to /new-submission to resume a specific IndexedDB draft (offline-safe). */
export const INSTALLER_OFFLINE_DRAFT_ID_KEY = "installer-offline-draft-id";

const STORE_NAME = INSTALLER_DB_OFFLINE_DRAFTS_STORE;

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB unavailable: window.indexedDB is missing."));
      return;
    }
    const request = window.indexedDB.open(INSTALLER_OFFLINE_DB_NAME, INSTALLER_OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      ensureInstallerOfflineObjectStores(db);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(describeIndexedDbError("IndexedDB open failed (offline job drafts)", request.error));
  });
}

export async function saveOfflineJobCardDraft<TDraftData>(
  record: OfflineJobCardDraftRecord<TDraftData>,
): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onerror = () => reject(req.error || new Error("Failed to put offline draft"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to save offline draft"));
    tx.onabort = () => reject(new Error("Offline draft save transaction aborted"));
  });
  db.close();
}

/** All drafts, newest first. Legacy records missing metadata are still returned. */
export async function getAllOfflineJobCardDrafts<TDraftData>(): Promise<OfflineJobCardDraftRecord<TDraftData>[]> {
  const db = await openOfflineDb();
  const all = await new Promise<OfflineJobCardDraftRecord<TDraftData>[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as OfflineJobCardDraftRecord<TDraftData>[] | undefined) || []);
    request.onerror = () => reject(request.error || new Error("Failed to read offline drafts"));
  });
  db.close();
  all.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return all;
}

/** @deprecated Use getAllOfflineJobCardDrafts */
export async function listOfflineJobCardDrafts<TDraftData>(): Promise<OfflineJobCardDraftRecord<TDraftData>[]> {
  return getAllOfflineJobCardDrafts<TDraftData>();
}

/** @deprecated Prefer getAllOfflineJobCardDrafts — kept for any legacy callers */
export async function getLatestOfflineJobCardDraft<TDraftData>(): Promise<OfflineJobCardDraftRecord<TDraftData> | null> {
  const rows = await getAllOfflineJobCardDrafts<TDraftData>();
  return rows[0] || null;
}

export async function getOfflineJobCardDraftById<TDraftData>(
  offlineDraftId: string,
): Promise<OfflineJobCardDraftRecord<TDraftData> | null> {
  const db = await openOfflineDb();
  const row = await new Promise<OfflineJobCardDraftRecord<TDraftData> | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(offlineDraftId);
    request.onsuccess = () => resolve((request.result as OfflineJobCardDraftRecord<TDraftData> | undefined) || null);
    request.onerror = () => reject(request.error || new Error("Failed to read offline draft"));
  });
  db.close();
  return row;
}

export async function deleteOfflineJobCardDraft(offlineDraftId: string): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(offlineDraftId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to delete offline draft"));
  });
  db.close();
}
