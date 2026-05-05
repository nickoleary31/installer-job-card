export type CachedCompanyItem = {
  id: string;
  name: string;
  active?: boolean;
};

export type CachedProjectItem = {
  id: string;
  project_name: string;
  active: boolean;
  displayCustomerName: string;
  completedSubmissionCount: number;
};

export type StarterDataSnapshot = {
  userId: string;
  cachedAt: string;
  profile: {
    globalRole: "admin" | "technician" | null;
    companyIds: string[];
    companyRolesById: Record<string, "admin" | "technician">;
  };
  companies: CachedCompanyItem[];
  projectsByCompanyId: Record<string, CachedProjectItem[]>;
};

const DB_NAME = "installer-sheetz-offline";
const DB_VERSION = 2;
const STORE_NAME = "starter-data-cache";

function openStarterDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "userId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open starter-data IndexedDB"));
  });
}

export async function getStarterDataSnapshot(userId: string): Promise<StarterDataSnapshot | null> {
  const db = await openStarterDb();
  const result = await new Promise<StarterDataSnapshot | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(userId);
    request.onsuccess = () => resolve((request.result as StarterDataSnapshot | undefined) || null);
    request.onerror = () => reject(request.error || new Error("Failed to read starter data cache"));
  });
  db.close();
  return result;
}

/**
 * Prefer the snapshot for the signed-in user; otherwise use the newest snapshot in the store
 * (single-device / last cached account) so the Companies page can render before auth finishes offline.
 */
export async function getBestStarterSnapshotForOffline(preferredUserId?: string | null): Promise<StarterDataSnapshot | null> {
  if (preferredUserId) {
    const exact = await getStarterDataSnapshot(preferredUserId);
    if (exact) return exact;
  }

  const db = await openStarterDb();
  try {
    const rows = await new Promise<StarterDataSnapshot[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as StarterDataSnapshot[]) || []);
      request.onerror = () => reject(request.error || new Error("Failed to list starter data cache"));
    });
    if (rows.length === 0) return null;
    return rows.reduce((best, cur) =>
      new Date(cur.cachedAt).getTime() >= new Date(best.cachedAt).getTime() ? cur : best,
    );
  } finally {
    db.close();
  }
}

export async function upsertStarterDataSnapshot(
  userId: string,
  updater: (prev: StarterDataSnapshot | null) => StarterDataSnapshot,
): Promise<void> {
  const db = await openStarterDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const readReq = store.get(userId);
    readReq.onsuccess = () => {
      const prev = (readReq.result as StarterDataSnapshot | undefined) || null;
      const next = updater(prev);
      store.put(next);
    };
    readReq.onerror = () => reject(readReq.error || new Error("Failed to read starter data cache before update"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to write starter data cache"));
  });
  db.close();
}

export async function deleteStarterDataSnapshot(userId: string): Promise<void> {
  const db = await openStarterDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(userId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to clear starter data cache"));
  });
  db.close();
}
