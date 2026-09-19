"use client";

import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-base";
import {
  resolveCompanyProducts,
  getCompanyProductDefinitionsRepository,
  type CompanyProductResolveResult,
  type CompanyFormProductRow,
} from "@/lib/product-config";
import { supabase } from "@/lib/supabase/client";

const EMPTY: CompanyProductResolveResult = {
  products: [],
  selectableProducts: [],
  source: "registry",
  usedDatabase: false,
  fellBackDueToError: false,
  configWarnings: [],
};

/**
 * Hybrid product resolution for the job-card form.
 * Never blocks technicians: registry fallback on missing table / network errors.
 */
export function useCompanyProducts(args: {
  companyId: string | null | undefined;
  companyName: string | null | undefined;
  enabled: boolean;
  /**
   * Phase 2E — native-only authoritative offline path (see
   * NewSubmissionForm.tsx's own authMode check). When true, fetchProducts
   * reads the locally provisioned CompanyProductDefinitionsPackage instead
   * of calling /api/company-products, then hands its raw rows to the SAME
   * resolveCompanyProducts() the online path uses below — one shared
   * view-model boundary, never a second interpretation of the rows.
   */
  isOfflineAuthorized?: boolean;
}) {
  const { companyId, companyName, enabled, isOfflineAuthorized } = args;
  const [result, setResult] = useState<CompanyProductResolveResult>(EMPTY);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) {
      setResult(EMPTY);
      return;
    }

    setLoading(true);
    try {
      const resolved = await resolveCompanyProducts({
        companyId,
        companyName,
        fetchProducts: async (id) => {
          if (isOfflineAuthorized) {
            try {
              const pkg = await getCompanyProductDefinitionsRepository().loadCompanyProductDefinitions(id);
              if (!pkg) {
                return { rows: [], error: "Product definitions were not synced to this device." };
              }
              return { rows: pkg.rows };
            } catch (e) {
              return {
                rows: [],
                error: e instanceof Error ? e.message : "Failed to load offline product definitions.",
              };
            }
          }
          try {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token?.trim() || "";
            if (!token) {
              return { rows: [], error: "Not signed in." };
            }
            const res = await fetch(apiUrl(`/api/company-products?companyId=${encodeURIComponent(id)}`), {
              headers: { Authorization: `Bearer ${token}` },
            });
            const json = (await res.json()) as {
              products?: CompanyFormProductRow[];
              error?: string;
              fallbackToRegistry?: boolean;
            };
            if (json.fallbackToRegistry || !res.ok) {
              return { rows: [], error: json.error || `HTTP ${res.status}` };
            }
            return { rows: json.products || [] };
          } catch (e) {
            return {
              rows: [],
              error: e instanceof Error ? e.message : "Failed to load company products.",
            };
          }
        },
      });
      setResult(resolved);
    } finally {
      setLoading(false);
    }
  }, [companyId, companyName, enabled, isOfflineAuthorized]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  return { ...result, loading, reload };
}
