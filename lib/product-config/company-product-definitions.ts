import {
  INSTALLER_DB_COMPANY_PRODUCT_DEFINITIONS_STORE,
  INSTALLER_OFFLINE_DB_NAME,
  INSTALLER_OFFLINE_DB_VERSION,
  describeIndexedDbError,
  ensureInstallerOfflineObjectStores,
} from "../installer-offline-db.ts";
import { getNativeCompanyProductDefinitions } from "../native/company-product-definitions.ts";
import { isNativeRuntime } from "../native/runtime.ts";
import type { CompanyFormProductRow } from "./types.ts";

/**
 * Phase 2E — the locally provisioned catalog of a company's
 * `company_form_products` rows, exactly as `/api/company-products` would
 * return them online. Deliberately company-scoped, NOT user-scoped: the
 * product catalog is shared by every technician/project under the same
 * company, so caching it once per company (not once per user, and not
 * duplicated into every ProjectWorkPackage) avoids redundant storage —
 * see saveCompanyProductDefinitions()'s own doc for why this is safe
 * despite not carrying its own per-user ACL.
 *
 * `rows` is ALWAYS written during provisioning, even as an empty array —
 * that is the signal distinguishing "this company genuinely has zero
 * custom products, the hardcoded registry fallback is correct" (empty
 * array, but the row EXISTS) from "we never successfully checked this
 * company" (no row at all) — see the offline gate in
 * ProjectDetailScreen.tsx / mobile-web/app/new-submission/page.tsx, which
 * requires this row to exist before allowing offline New Submission.
 *
 * Deliberately caches the RAW rows, not a pre-normalized/resolved product
 * list: lib/product-config/resolve-company-products.ts's
 * resolveCompanyProducts() is already pure and injectable (a
 * `fetchProducts` callback) — reusing it verbatim, both online and
 * offline, with only the fetchProducts implementation swapped, is the
 * "one shared view-model boundary" the offline path is built around. See
 * lib/product-config/use-company-products.ts's offline-aware fetchProducts.
 */
export type CompanyProductDefinitionsPackage = {
  companyId: string;
  rows: CompanyFormProductRow[];
  schemaVersion: number;
  syncedAt: string;
};

export interface CompanyProductDefinitionsRepository {
  /**
   * Upserts this company's full row set. Resolves with the syncedAt
   * actually committed. Rejects, leaving any previous package for this
   * exact companyId fully intact, if the write fails — a caller must
   * never treat a rejection as "the old definitions are gone."
   */
  saveCompanyProductDefinitions(companyId: string, rows: readonly CompanyFormProductRow[]): Promise<{ syncedAt: string }>;
  loadCompanyProductDefinitions(companyId: string): Promise<CompanyProductDefinitionsPackage | null>;
  clearCompanyProductDefinitions(companyId: string): Promise<void>;
}

const CURRENT_SCHEMA_VERSION = 1;
const STORE_NAME = INSTALLER_DB_COMPANY_PRODUCT_DEFINITIONS_STORE;

function openCompanyProductDefinitionsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB unavailable: window.indexedDB is missing (SSR, unsupported browser, or storage blocked)."));
      return;
    }
    const request = window.indexedDB.open(INSTALLER_OFFLINE_DB_NAME, INSTALLER_OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => ensureInstallerOfflineObjectStores(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(describeIndexedDbError("IndexedDB open failed (company product definitions)", request.error));
  });
}

/** Mirrors the other lib/*-package.ts web implementations — one record per companyId, a single put() is atomic. */
class WebIndexedDbCompanyProductDefinitions implements CompanyProductDefinitionsRepository {
  async saveCompanyProductDefinitions(
    companyId: string,
    rows: readonly CompanyFormProductRow[],
  ): Promise<{ syncedAt: string }> {
    const db = await openCompanyProductDefinitionsDb();
    const syncedAt = new Date().toISOString();
    const record: CompanyProductDefinitionsPackage = {
      companyId,
      rows: [...rows],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      syncedAt,
    };
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(describeIndexedDbError("IndexedDB write failed (company product definitions save)", tx.error));
        tx.onabort = () => reject(new Error("IndexedDB write failed: company product definitions save transaction aborted."));
      });
      return { syncedAt };
    } finally {
      db.close();
    }
  }

  async loadCompanyProductDefinitions(companyId: string): Promise<CompanyProductDefinitionsPackage | null> {
    const db = await openCompanyProductDefinitionsDb();
    try {
      return await new Promise<CompanyProductDefinitionsPackage | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(companyId);
        req.onsuccess = () => resolve((req.result as CompanyProductDefinitionsPackage | undefined) ?? null);
        req.onerror = () => reject(describeIndexedDbError("IndexedDB read failed (company product definitions load)", req.error));
      });
    } finally {
      db.close();
    }
  }

  async clearCompanyProductDefinitions(companyId: string): Promise<void> {
    const db = await openCompanyProductDefinitionsDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(companyId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(describeIndexedDbError("IndexedDB delete failed (company product definitions clear)", tx.error));
      });
    } finally {
      db.close();
    }
  }
}

const webCompanyProductDefinitionsSingleton = new WebIndexedDbCompanyProductDefinitions();

export function getCompanyProductDefinitionsRepository(): CompanyProductDefinitionsRepository {
  return isNativeRuntime() ? getNativeCompanyProductDefinitions() : webCompanyProductDefinitionsSingleton;
}
