"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import {
  findSingleInstancePairingConfigWarnings,
  normalizeDatabaseProductRow,
  pairingFieldsFromConfiguration,
  type CompanyFormProductRow,
  type ProductConfiguration,
} from "@/lib/product-config";
import { supabase } from "@/lib/supabase/client";

type BaseFormOption = { id: string; label: string };

type EditorState = {
  id?: string;
  productKey: string;
  displayLabel: string;
  baseFormId: string;
  allowPrimary: boolean;
  allowAdditional: boolean;
  active: boolean;
  displayOrder: number;
  allowedAdditionalProductKeys: string[];
  maxAdditionalCount: string;
  /** Unknown configuration keys preserved across save (forward compatible). */
  configurationExtra: Record<string, unknown>;
};

const emptyEditor = (): EditorState => ({
  productKey: "",
  displayLabel: "",
  baseFormId: "ppd",
  allowPrimary: true,
  allowAdditional: false,
  active: true,
  displayOrder: 100,
  allowedAdditionalProductKeys: [],
  maxAdditionalCount: "1",
  configurationExtra: {},
});

function configFromEditor(editor: EditorState): ProductConfiguration {
  const pairing = pairingFieldsFromConfiguration({
    allowedAdditionalProductKeys: editor.allowedAdditionalProductKeys,
    maxAdditionalCount:
      editor.maxAdditionalCount.trim() === ""
        ? undefined
        : Number(editor.maxAdditionalCount),
  });
  return {
    ...editor.configurationExtra,
    ...pairing,
  };
}

function extractConfigurationExtra(config: ProductConfiguration | Record<string, unknown> | null | undefined) {
  const raw = { ...(config || {}) } as Record<string, unknown>;
  delete raw.allowedAdditionalProductKeys;
  delete raw.maxAdditionalCount;
  return raw;
}

export default function AdminCompanyFormsPage() {
  const params = useParams<{ companyId: string }>();
  const companyId = String(params.companyId || "");
  const router = useRouter();
  const { loading: authLoading, context } = useAuthUserContext();
  const isGlobalAdmin = context.globalRole === "admin" && context.profileIsActive;

  const [companyName, setCompanyName] = useState("");
  const [products, setProducts] = useState<CompanyFormProductRow[]>([]);
  const [baseForms, setBaseForms] = useState<BaseFormOption[]>([]);
  const [pairingWarnings, setPairingWarnings] = useState<string[]>([]);
  const [tableAvailable, setTableAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const editingExisting = !!editor.id;

  const getAccessToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token?.trim() || "";
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You must be signed in.");
      const res = await fetch(`/api/admin/form-products/${encodeURIComponent(companyId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as {
        error?: string;
        company?: { id: string; name: string };
        products?: CompanyFormProductRow[];
        baseForms?: BaseFormOption[];
        pairingWarnings?: string[];
        tableAvailable?: boolean;
      };
      if (!res.ok && res.status !== 503) throw new Error(json.error || `Failed to load (${res.status})`);
      setCompanyName(json.company?.name || "");
      setProducts(json.products || []);
      setBaseForms(json.baseForms || []);
      setPairingWarnings(json.pairingWarnings || []);
      setTableAvailable(json.tableAvailable !== false);
      if (json.error && res.status === 503) setError(json.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load products.");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (authLoading) return;
    if (!context.userId) {
      router.replace("/login");
      return;
    }
    if (!isGlobalAdmin) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, context.userId, isGlobalAdmin, load, router]);

  const productKeyOptions = useMemo(
    () => products.map((p) => ({ key: p.product_key, label: p.display_label })),
    [products],
  );

  const openCreate = () => {
    const next = emptyEditor();
    next.baseFormId = baseForms[0]?.id || "ppd";
    next.displayOrder = (products.reduce((max, p) => Math.max(max, p.display_order), 0) || 0) + 10;
    setEditor(next);
    setEditorOpen(true);
    setNotice(null);
  };

  const openEdit = (row: CompanyFormProductRow) => {
    const config = (row.configuration || {}) as ProductConfiguration;
    setEditor({
      id: row.id,
      productKey: row.product_key,
      displayLabel: row.display_label,
      baseFormId: row.base_form_id,
      allowPrimary: row.allow_primary,
      allowAdditional: row.allow_additional,
      active: row.active,
      displayOrder: row.display_order,
      allowedAdditionalProductKeys: config.allowedAdditionalProductKeys || [],
      maxAdditionalCount:
        config.maxAdditionalCount === undefined || config.maxAdditionalCount === null
          ? ""
          : String(config.maxAdditionalCount),
      configurationExtra: extractConfigurationExtra(config),
    });
    setEditorOpen(true);
    setNotice(null);
  };

  const saveEditor = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You must be signed in.");
      const body = editingExisting
        ? {
            action: "update",
            id: editor.id,
            displayLabel: editor.displayLabel,
            baseFormId: editor.baseFormId,
            allowPrimary: editor.allowPrimary,
            allowAdditional: editor.allowAdditional,
            active: editor.active,
            displayOrder: editor.displayOrder,
            configuration: configFromEditor(editor),
          }
        : {
            action: "create",
            productKey: editor.productKey,
            displayLabel: editor.displayLabel,
            baseFormId: editor.baseFormId,
            allowPrimary: editor.allowPrimary,
            allowAdditional: editor.allowAdditional,
            active: editor.active,
            displayOrder: editor.displayOrder,
            configuration: configFromEditor(editor),
          };
      const res = await fetch(`/api/admin/form-products/${encodeURIComponent(companyId)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`);
      setNotice(editingExisting ? "Product updated." : "Product created.");
      setEditorOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row: CompanyFormProductRow) => {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You must be signed in.");
      const res = await fetch(`/api/admin/form-products/${encodeURIComponent(companyId)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "setActive", id: row.id, active: !row.active }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `Update failed (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const previewPrimary = editor.allowPrimary && editor.active ? editor.displayLabel || "(label)" : null;
  const previewAdditional =
    editor.allowAdditional && editor.active ? editor.displayLabel || "(label)" : null;

  const livePairingWarnings = useMemo(() => {
    if (products.length === 0 && !editorOpen) return pairingWarnings;
    const draftRows = products.map((row) => {
      if (!editorOpen || !editor.id || row.id !== editor.id) return row;
      return {
        ...row,
        display_label: editor.displayLabel,
        base_form_id: editor.baseFormId,
        allow_primary: editor.allowPrimary,
        allow_additional: editor.allowAdditional,
        active: editor.active,
        display_order: editor.displayOrder,
        configuration: configFromEditor(editor),
      };
    });
    if (editorOpen && !editor.id) {
      draftRows.push({
        id: "draft",
        company_id: companyId,
        product_key: editor.productKey || "draft_product",
        display_label: editor.displayLabel || "Draft",
        base_form_id: editor.baseFormId,
        section_key: editor.productKey || "draft_product",
        submission_type: editor.productKey || "draft_product",
        draft_key: editor.productKey || "draft_product",
        allow_primary: editor.allowPrimary,
        allow_additional: editor.allowAdditional,
        active: editor.active,
        display_order: editor.displayOrder,
        configuration: configFromEditor(editor),
      });
    }
    return findSingleInstancePairingConfigWarnings(draftRows.map(normalizeDatabaseProductRow));
  }, [products, pairingWarnings, editorOpen, editor, companyId]);

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-gray-600">Checking sign-in…</p>
      </main>
    );
  }

  if (!isGlobalAdmin) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
          Only active global admins can manage form/product configuration.
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-12 pt-6 sm:px-5">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link href="/admin/forms" className="text-sm font-semibold text-blue-700 underline">
                ← All companies
              </Link>
              <h1 className="mt-2 text-2xl font-bold text-gray-950">{companyName || "Company products"}</h1>
              <p className="mt-1 text-sm text-gray-600">
                Database products override registry assignments for this company once rows exist.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreate}
              disabled={!tableAvailable || busy}
              className="inline-flex min-h-[40px] items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Add product
            </button>
          </div>
        </header>

        {!tableAvailable && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Apply migration <code>20260730120000_company_form_products.sql</code> before creating products.
            Blaxtair seed SQL is at <code>supabase/seed/blaxtair_company_form_products.sql</code>.
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
        )}
        {livePairingWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold">Pairing configuration warning</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {livePairingWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-900/80">
              Configuration is not rewritten automatically. Prefer whitelists so only one single-instance
              PPD-family product can appear on a card (e.g. one Blaxtair device + optional SSC Speed).
            </p>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-3">
            <h2 className="text-sm font-bold text-gray-900">Configured products</h2>
          </div>
          {loading ? (
            <p className="px-5 py-6 text-sm text-gray-600">Loading…</p>
          ) : products.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-600">
              No database products yet. This company still uses registry fallback.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Label</th>
                    <th className="px-4 py-3">Key</th>
                    <th className="px-4 py-3">Base form</th>
                    <th className="px-4 py-3">Primary</th>
                    <th className="px-4 py-3">Additional</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Order</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {products.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-3 font-semibold text-gray-950">{row.display_label}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.product_key}</td>
                      <td className="px-4 py-3">{row.base_form_id}</td>
                      <td className="px-4 py-3">{row.allow_primary ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">{row.allow_additional ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">{row.active ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">{row.display_order}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold"
                            onClick={() => openEdit(row)}
                            disabled={busy}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold"
                            onClick={() => void toggleActive(row)}
                            disabled={busy}
                          >
                            {row.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {editorOpen && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-gray-950">
              {editingExisting ? "Edit product" : "Add product"}
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block text-sm font-semibold text-gray-800">
                Display label
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  value={editor.displayLabel}
                  onChange={(e) => setEditor((prev) => ({ ...prev, displayLabel: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-semibold text-gray-800">
                Stable product key
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm disabled:bg-slate-100"
                  value={editor.productKey}
                  disabled={editingExisting}
                  onChange={(e) =>
                    setEditor((prev) => ({ ...prev, productKey: e.target.value.toLowerCase() }))
                  }
                  placeholder="blaxtair_ahd"
                />
                <span className="mt-1 block text-xs font-normal text-gray-500">
                  Immutable after create. Used in drafts/submissions.
                </span>
              </label>
              <label className="block text-sm font-semibold text-gray-800">
                Base form
                <select
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  value={editor.baseFormId}
                  onChange={(e) => setEditor((prev) => ({ ...prev, baseFormId: e.target.value }))}
                >
                  {baseForms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label} ({f.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-semibold text-gray-800">
                Display order
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  value={editor.displayOrder}
                  onChange={(e) =>
                    setEditor((prev) => ({ ...prev, displayOrder: Number(e.target.value) || 0 }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <input
                  type="checkbox"
                  checked={editor.allowPrimary}
                  onChange={(e) => setEditor((prev) => ({ ...prev, allowPrimary: e.target.checked }))}
                />
                Allow as primary
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <input
                  type="checkbox"
                  checked={editor.allowAdditional}
                  onChange={(e) =>
                    setEditor((prev) => ({ ...prev, allowAdditional: e.target.checked }))
                  }
                />
                Allow as additional
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <input
                  type="checkbox"
                  checked={editor.active}
                  onChange={(e) => setEditor((prev) => ({ ...prev, active: e.target.checked }))}
                />
                Active
              </label>
              <label className="block text-sm font-semibold text-gray-800">
                Max additional count (optional)
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  value={editor.maxAdditionalCount}
                  onChange={(e) =>
                    setEditor((prev) => ({ ...prev, maxAdditionalCount: e.target.value }))
                  }
                  placeholder="1"
                />
              </label>
            </div>

            <div className="mt-4">
              <p className="text-sm font-semibold text-gray-800">Allowed additional products (optional)</p>
              <p className="mt-1 text-xs text-gray-500">
                Leave empty to allow any product marked “Allow as additional”. For Blaxtair devices, select
                SSC Speed only.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {productKeyOptions
                  .filter((p) => p.key !== editor.productKey)
                  .map((p) => {
                    const checked = editor.allowedAdditionalProductKeys.includes(p.key);
                    return (
                      <label key={p.key} className="flex items-center gap-2 text-sm text-gray-800">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setEditor((prev) => ({
                              ...prev,
                              allowedAdditionalProductKeys: checked
                                ? prev.allowedAdditionalProductKeys.filter((k) => k !== p.key)
                                : [...prev.allowedAdditionalProductKeys, p.key],
                            }))
                          }
                        />
                        {p.label} <span className="font-mono text-xs text-gray-500">({p.key})</span>
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <p className="font-semibold text-gray-900">Selection preview</p>
              <p className="mt-2 text-gray-700">
                Primary dropdown: {previewPrimary ? <strong>{previewPrimary}</strong> : <em>not shown</em>}
              </p>
              <p className="mt-1 text-gray-700">
                Additional checkbox:{" "}
                {previewAdditional ? <strong>{previewAdditional}</strong> : <em>not shown</em>}
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void saveEditor()}
                disabled={busy}
                className="inline-flex min-h-[40px] items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save product"}
              </button>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-800"
              >
                Cancel
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
