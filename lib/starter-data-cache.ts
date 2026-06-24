import {
  INSTALLER_DB_STARTER_STORE,
  INSTALLER_OFFLINE_DB_NAME,
  INSTALLER_OFFLINE_DB_VERSION,
  describeIndexedDbError,
  ensureInstallerOfflineObjectStores,
} from "@/lib/installer-offline-db";

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
  /** Site / project address when cached from online project list */
  displayLocation?: string;
  completedSubmissionCount: number;
};

export type StarterDataSnapshot = {
  userId: string;
  cachedAt: string;
  profile: {
    globalRole: "admin" | "technician" | null;
    displayName?: string | null;
    email?: string | null;
    companyIds: string[];
    companyRolesById: Record<string, "admin" | "technician">;
  };
  companies: CachedCompanyItem[];
  projectsByCompanyId: Record<string, CachedProjectItem[]>;
};

const STORE_NAME = INSTALLER_DB_STARTER_STORE;

function openStarterDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB unavailable: window.indexedDB is missing (SSR, unsupported browser, or storage blocked)."));
      return;
    }
    const request = window.indexedDB.open(INSTALLER_OFFLINE_DB_NAME, INSTALLER_OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      ensureInstallerOfflineObjectStores(db);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(describeIndexedDbError("IndexedDB open failed (starter cache)", request.error));
  });
}

export async function getStarterDataSnapshot(userId: string): Promise<StarterDataSnapshot | null> {
  const db = await openStarterDb();
  try {
    return await new Promise<StarterDataSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(userId);
      req.onsuccess = () => resolve((req.result as StarterDataSnapshot | undefined) || null);
      req.onerror = () =>
        reject(describeIndexedDbError("IndexedDB read failed (starter snapshot get)", req.error));
      tx.onerror = () =>
        reject(describeIndexedDbError("IndexedDB transaction failed (starter snapshot read)", tx.error));
      tx.onabort = () =>
        reject(new Error("IndexedDB read failed: starter snapshot transaction aborted."));
    });
  } finally {
    db.close();
  }
}

/**
 * Prefer the snapshot for the signed-in user; otherwise use the newest snapshot in the store
 * (single-device / last cached account) so the Companies page can render before auth finishes offline.
 */
export async function getBestStarterSnapshotForOffline(preferredUserId?: string | null): Promise<StarterDataSnapshot | null> {
  try {
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
        request.onerror = () =>
          reject(describeIndexedDbError("IndexedDB read failed (starter snapshot getAll)", request.error));
        tx.onerror = () =>
          reject(describeIndexedDbError("IndexedDB transaction failed (starter snapshot list)", tx.error));
        tx.onabort = () =>
          reject(new Error("IndexedDB read failed: starter list transaction aborted."));
      });
      if (rows.length === 0) return null;
      return rows.reduce((best, cur) =>
        new Date(cur.cachedAt).getTime() >= new Date(best.cachedAt).getTime() ? cur : best,
      );
    } finally {
      db.close();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg.startsWith("IndexedDB") ? msg : `IndexedDB read failed: ${msg}`);
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
      try {
        const prev = (readReq.result as StarterDataSnapshot | undefined) || null;
        const next = updater(prev);
        const putReq = store.put(next);
        putReq.onerror = () =>
          reject(describeIndexedDbError("IndexedDB write failed (starter snapshot put)", putReq.error));
      } catch (syncErr) {
        reject(syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
      }
    };
    readReq.onerror = () =>
      reject(describeIndexedDbError("IndexedDB read failed (starter snapshot before upsert)", readReq.error));
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(describeIndexedDbError("IndexedDB transaction failed (starter snapshot upsert)", tx.error));
    tx.onabort = () => reject(new Error("IndexedDB write failed: starter snapshot upsert aborted."));
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
    tx.onerror = () =>
      reject(describeIndexedDbError("IndexedDB transaction failed (starter snapshot delete)", tx.error));
    tx.onabort = () => reject(new Error("IndexedDB delete failed: starter snapshot transaction aborted."));
  });
  db.close();
}
