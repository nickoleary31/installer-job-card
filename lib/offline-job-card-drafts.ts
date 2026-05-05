export type OfflineJobCardDraftRecord<TDraftData> = {
  offlineDraftId: string;
  submissionId: string;
  savedAt: string;
  selectedSections: string[];
  data: TDraftData;
  photoRestoreSupported: boolean;
};

const DB_NAME = "installer-sheetz-offline";
const DB_VERSION = 1;
const STORE_NAME = "job-card-offline-drafts";

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "offlineDraftId" });
        store.createIndex("savedAt", "savedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
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

export async function getLatestOfflineJobCardDraft<TDraftData>(): Promise<OfflineJobCardDraftRecord<TDraftData> | null> {
  const db = await openOfflineDb();
  const all = await new Promise<OfflineJobCardDraftRecord<TDraftData>[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as OfflineJobCardDraftRecord<TDraftData>[] | undefined) || []);
    request.onerror = () => reject(request.error || new Error("Failed to read offline drafts"));
  });
  db.close();
  if (all.length === 0) return null;
  all.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return all[0] || null;
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
