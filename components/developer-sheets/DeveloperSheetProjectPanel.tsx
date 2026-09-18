"use client";

/**
 * Replaces the normal installation Job Card content on a project page when that project's
 * company is flagged workflow_type = 'developer_sheet'. Renders the persistent Product Sheet
 * ("Developer Sheet card") list for this project and a create action. Never touches
 * job_card_drafts/job_card_submissions — this is the developer_sheet_cards table only.
 *
 * Anyone who can render this panel already passed the project page's own access check (global
 * admin, active company admin, or an assigned technician), so the create action needs no further
 * client-side gating here — RLS is the authority regardless.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { DeveloperSheetCard } from "@/lib/developer-sheets/types";

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function previewScope(scope: string | null): string {
  const trimmed = scope?.trim() || "";
  if (!trimmed) return "No product scope yet.";
  return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;
}

export function DeveloperSheetProjectPanel({
  companyId,
  projectId,
}: {
  companyId: string;
  projectId: string;
}) {
  const [cards, setCards] = useState<DeveloperSheetCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadCards = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from("developer_sheet_cards")
        .select(
          "id, company_id, project_id, product_name, product_scope, product_part_numbers, additional_notes, developer_summary, is_active, archived_at, archived_by, created_by, updated_by, created_at, updated_at",
        )
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      setCards((data as DeveloperSheetCard[] | null) || []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load Developer Sheets.");
      setCards([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleCreate = async () => {
    const productName = newProductName.trim();
    if (!productName) {
      setCreateError("Product name is required.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const { error } = await supabase.from("developer_sheet_cards").insert({
        project_id: projectId,
        product_name: productName,
      });
      if (error) throw error;
      setNewProductName("");
      setShowCreateForm(false);
      await loadCards();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create Developer Sheet.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Product Sheets</h2>
          <p className="mt-1 text-sm text-gray-600">Living documentation, not an installation job card.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowCreateForm((prev) => !prev);
            setCreateError(null);
          }}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
        >
          + New Product Sheet
        </button>
      </div>

      {showCreateForm ? (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
          <label className="mb-1 block text-sm font-semibold text-gray-800">Product Name</label>
          <input
            value={newProductName}
            onChange={(event) => {
              setNewProductName(event.target.value);
              setCreateError(null);
            }}
            placeholder="e.g. Lidar System"
            className="w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
            autoFocus
          />
          {createError ? <p className="mt-2 text-sm font-semibold text-amber-700">{createError}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setNewProductName("");
                setCreateError(null);
              }}
              disabled={creating}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {loading ? <p className="text-sm text-gray-600">Loading Developer Sheets…</p> : null}
        {loadError ? <p className="text-sm font-semibold text-amber-700">Could not load Developer Sheets: {loadError}</p> : null}
        {!loading && !loadError && cards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
            No products documented yet. Use “+ New Product Sheet” to start one.
          </p>
        ) : null}
        {!loading && !loadError
          ? cards.map((card) => (
              <Link
                key={card.id}
                href={`/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/developer-sheets/${encodeURIComponent(card.id)}`}
                className={`block rounded-xl border p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-blue-300 hover:bg-blue-50/40 ${
                  card.is_active ? "border-gray-200 bg-gray-50" : "border-amber-200 bg-amber-50/60"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-base font-bold text-gray-900">{card.product_name}</h3>
                  {!card.is_active ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Archived</span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-gray-700">{previewScope(card.product_scope)}</p>
                {card.product_part_numbers.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {card.product_part_numbers.map((partNumber) => (
                      <span
                        key={partNumber}
                        className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700"
                      >
                        {partNumber}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-gray-500">Updated {formatUpdatedAt(card.updated_at)}</p>
              </Link>
            ))
          : null}
      </div>
    </section>
  );
}
