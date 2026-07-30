"use client";

import { useCallback, useEffect, useState } from "react";
import {
  resolveCompanyProducts,
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
}) {
  const { companyId, companyName, enabled } = args;
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
          try {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token?.trim() || "";
            if (!token) {
              return { rows: [], error: "Not signed in." };
            }
            const res = await fetch(`/api/company-products?companyId=${encodeURIComponent(id)}`, {
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
  }, [companyId, companyName, enabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  return { ...result, loading, reload };
}
