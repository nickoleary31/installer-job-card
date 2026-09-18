"use client";

/**
 * A single persistent Developer Sheet ("Product Sheet"): Product Information, Documentation
 * entries (with photos), and the Developer Summary. Intentionally its own route/component tree,
 * separate from the ~11k-line job-card form — this domain never touches job_card_drafts/
 * job_card_submissions, only developer_sheet_cards/developer_sheet_documentation_entries/
 * developer_sheet_documentation_photos. Backend RLS (validated separately) is the authority on
 * who can do what; this page just reflects it — a query returning zero rows means "not found or
 * not authorized," which is the correct, safe outcome either way.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";
import { DocumentationEntryCard } from "@/components/developer-sheets/DocumentationEntryCard";
import {
  formatPartNumbersForInput,
  parsePartNumbersInput,
  type DeveloperSheetCard,
  type DeveloperSheetDocumentationEntry,
} from "@/lib/developer-sheets/types";

type UserProfileLookupRow = {
  id: string;
  display_name: string | null;
  email: string | null;
};

export default function DeveloperSheetCardPage() {
  const params = useParams<{ companyId: string; projectId: string; cardId: string }>();
  const { loading: authLoading, context: userContext } = useAuthUserContext();
  const companyId = String(params.companyId || "");
  const projectId = String(params.projectId || "");
  const cardId = String(params.cardId || "");
  const companyRole = userContext.companyRolesById[companyId];
  const isGlobalAdmin = userContext.globalRole === "admin";
  const canArchive = isGlobalAdmin || companyRole === "admin";

  const [card, setCard] = useState<DeveloperSheetCard | null>(null);
  const [cardLoading, setCardLoading] = useState(true);
  const [cardError, setCardError] = useState<string | null>(null);

  const [productName, setProductName] = useState("");
  const [productScope, setProductScope] = useState("");
  const [partNumbersInput, setPartNumbersInput] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [savingProductInfo, setSavingProductInfo] = useState(false);
  const [productInfoError, setProductInfoError] = useState<string | null>(null);
  const [productInfoSaved, setProductInfoSaved] = useState(false);

  const [developerSummary, setDeveloperSummary] = useState("");
  const [savingSummary, setSavingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summarySaved, setSummarySaved] = useState(false);

  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const [entries, setEntries] = useState<DeveloperSheetDocumentationEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [contributorLabels, setContributorLabels] = useState<Record<string, string>>({});

  const [showAddEntry, setShowAddEntry] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newPartNumber, setNewPartNumber] = useState("");
  const [newTag, setNewTag] = useState("");
  const [creatingEntry, setCreatingEntry] = useState(false);
  const [createEntryError, setCreateEntryError] = useState<string | null>(null);

  const loadCard = async () => {
    setCardLoading(true);
    setCardError(null);
    try {
      const { data, error } = await supabase
        .from("developer_sheet_cards")
        .select(
          "id, company_id, project_id, product_name, product_scope, product_part_numbers, additional_notes, developer_summary, is_active, archived_at, archived_by, created_by, updated_by, created_at, updated_at",
        )
        .eq("id", cardId)
        .maybeSingle<DeveloperSheetCard>();
      if (error) throw error;
      if (!data) {
        setCard(null);
        return;
      }
      setCard(data);
      setProductName(data.product_name);
      setProductScope(data.product_scope || "");
      setPartNumbersInput(formatPartNumbersForInput(data.product_part_numbers));
      setAdditionalNotes(data.additional_notes || "");
      setDeveloperSummary(data.developer_summary || "");
    } catch (error) {
      setCardError(error instanceof Error ? error.message : "Failed to load Developer Sheet.");
      setCard(null);
    } finally {
      setCardLoading(false);
    }
  };

  const loadEntries = async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const { data, error } = await supabase
        .from("developer_sheet_documentation_entries")
        .select(
          "id, card_id, company_id, project_id, title, notes, part_number, tag, is_active, archived_at, archived_by, created_by, updated_by, created_at, updated_at",
        )
        .eq("card_id", cardId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data as DeveloperSheetDocumentationEntry[] | null) || [];
      setEntries(rows);

      const contributorIds = Array.from(
        new Set(
          rows.flatMap((row) => [row.created_by, row.updated_by]).filter((value): value is string => Boolean(value)),
        ),
      );
      if (contributorIds.length > 0) {
        const { data: userRows, error: userError } = await supabase
          .from("user_profiles")
          .select("id, display_name, email")
          .in("id", contributorIds);
        if (userError) throw userError;
        const labels = (((userRows as UserProfileLookupRow[] | null) || [])).reduce<Record<string, string>>((acc, row) => {
          acc[row.id] = row.display_name?.trim() || row.email?.trim() || row.id;
          return acc;
        }, {});
        setContributorLabels(labels);
      } else {
        setContributorLabels({});
      }
    } catch (error) {
      setEntriesError(error instanceof Error ? error.message : "Failed to load documentation entries.");
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  };

  useEffect(() => {
    if (!cardId || authLoading || !userContext.userId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCard();
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, authLoading, userContext.userId]);

  const contributorLabel = (userId: string | null): string => {
    if (!userId) return "Unknown contributor";
    if (userId === userContext.userId) return "You";
    return contributorLabels[userId] || "Unknown contributor";
  };

  const handleSaveProductInfo = async () => {
    if (!card) return;
    const trimmedName = productName.trim();
    if (!trimmedName) {
      setProductInfoError("Product name is required.");
      return;
    }
    setSavingProductInfo(true);
    setProductInfoError(null);
    setProductInfoSaved(false);
    try {
      const { data, error } = await supabase
        .from("developer_sheet_cards")
        .update({
          product_name: trimmedName,
          product_scope: productScope.trim() || null,
          product_part_numbers: parsePartNumbersInput(partNumbersInput),
          additional_notes: additionalNotes.trim() || null,
        })
        .eq("id", card.id)
        .select(
          "id, company_id, project_id, product_name, product_scope, product_part_numbers, additional_notes, developer_summary, is_active, archived_at, archived_by, created_by, updated_by, created_at, updated_at",
        )
        .single<DeveloperSheetCard>();
      if (error) throw error;
      setCard(data);
      setProductInfoSaved(true);
    } catch (error) {
      setProductInfoError(error instanceof Error ? error.message : "Failed to save Product Information.");
    } finally {
      setSavingProductInfo(false);
    }
  };

  const handleSaveSummary = async () => {
    if (!card) return;
    setSavingSummary(true);
    setSummaryError(null);
    setSummarySaved(false);
    try {
      const { data, error } = await supabase
        .from("developer_sheet_cards")
        .update({ developer_summary: developerSummary.trim() || null })
        .eq("id", card.id)
        .select(
          "id, company_id, project_id, product_name, product_scope, product_part_numbers, additional_notes, developer_summary, is_active, archived_at, archived_by, created_by, updated_by, created_at, updated_at",
        )
        .single<DeveloperSheetCard>();
      if (error) throw error;
      setCard(data);
      setSummarySaved(true);
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Failed to save Developer Summary.");
    } finally {
      setSavingSummary(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!card) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const { data, error } = await supabase
        .from("developer_sheet_cards")
        .update({ is_active: !card.is_active })
        .eq("id", card.id)
        .select(
          "id, company_id, project_id, product_name, product_scope, product_part_numbers, additional_notes, developer_summary, is_active, archived_at, archived_by, created_by, updated_by, created_at, updated_at",
        )
        .single<DeveloperSheetCard>();
      if (error) throw error;
      setCard(data);
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Failed to update archive state.");
    } finally {
      setArchiving(false);
    }
  };

  const handleCreateEntry = async () => {
    setCreatingEntry(true);
    setCreateEntryError(null);
    try {
      const { error } = await supabase.from("developer_sheet_documentation_entries").insert({
        card_id: cardId,
        title: newTitle.trim() || null,
        notes: newNotes.trim() || null,
        part_number: newPartNumber.trim() || null,
        tag: newTag.trim() || null,
      });
      if (error) throw error;
      setNewTitle("");
      setNewNotes("");
      setNewPartNumber("");
      setNewTag("");
      setShowAddEntry(false);
      await loadEntries();
    } catch (error) {
      setCreateEntryError(error instanceof Error ? error.message : "Failed to create documentation entry.");
    } finally {
      setCreatingEntry(false);
    }
  };

  const handleEntryChanged = (updated: DeveloperSheetDocumentationEntry) => {
    setEntries((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
  };

  const backHref = `/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}`;

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-5 sm:py-2">
        <Link href={backHref} className="inline-flex text-sm font-semibold text-blue-700 hover:underline">
          ← Back to Project
        </Link>

        {authLoading || cardLoading ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            Loading Developer Sheet…
          </section>
        ) : null}

        {!authLoading && !cardLoading && cardError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            Could not load Developer Sheet: {cardError}
          </section>
        ) : null}

        {!authLoading && !cardLoading && !cardError && !card ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            This Developer Sheet was not found, or you do not have access to it.
          </section>
        ) : null}

        {card ? (
          <>
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-gray-950">{card.product_name}</h1>
                <div className="flex items-center gap-2">
                  {!card.is_active ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Archived</span>
                  ) : null}
                  {canArchive ? (
                    <button
                      type="button"
                      onClick={() => void handleToggleArchive()}
                      disabled={archiving}
                      className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {archiving ? "Working…" : card.is_active ? "Archive" : "Restore"}
                    </button>
                  ) : null}
                </div>
              </div>
              {archiveError ? <p className="mt-2 text-sm font-semibold text-amber-700">{archiveError}</p> : null}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
              <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Product Information</h2>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Product Name</label>
                  <input
                    value={productName}
                    onChange={(event) => {
                      setProductName(event.target.value);
                      setProductInfoSaved(false);
                    }}
                    className="w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Product Scope</label>
                  <textarea
                    value={productScope}
                    onChange={(event) => {
                      setProductScope(event.target.value);
                      setProductInfoSaved(false);
                    }}
                    rows={3}
                    placeholder="What does this system/product do, and what may the install include?"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Product Part Number(s)</label>
                  <input
                    value={partNumbersInput}
                    onChange={(event) => {
                      setPartNumbersInput(event.target.value);
                      setProductInfoSaved(false);
                    }}
                    placeholder="Comma-separated, e.g. PN-1001, PN-1002"
                    className="w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Additional Product / Scope Notes</label>
                  <textarea
                    value={additionalNotes}
                    onChange={(event) => {
                      setAdditionalNotes(event.target.value);
                      setProductInfoSaved(false);
                    }}
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
                  />
                </div>
                {productInfoError ? <p className="text-sm font-semibold text-amber-700">{productInfoError}</p> : null}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSaveProductInfo()}
                    disabled={savingProductInfo}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingProductInfo ? "Saving…" : "Save Product Information"}
                  </button>
                  {productInfoSaved ? <span className="text-sm font-semibold text-emerald-700">Saved</span> : null}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Documentation</h2>
                <button
                  type="button"
                  onClick={() => setShowAddEntry((prev) => !prev)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
                >
                  + Add Documentation
                </button>
              </div>

              {showAddEntry ? (
                <div className="mt-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-700">Title (optional)</label>
                    <input
                      value={newTitle}
                      onChange={(event) => setNewTitle(event.target.value)}
                      className="w-full min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-700">Notes / Description</label>
                    <textarea
                      value={newNotes}
                      onChange={(event) => setNewNotes(event.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">Part Number (optional)</label>
                      <input
                        value={newPartNumber}
                        onChange={(event) => setNewPartNumber(event.target.value)}
                        className="w-full min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">Tag / Category (optional)</label>
                      <input
                        value={newTag}
                        onChange={(event) => setNewTag(event.target.value)}
                        placeholder="e.g. mounting, wiring"
                        className="w-full min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                      />
                    </div>
                  </div>
                  {createEntryError ? <p className="text-sm font-semibold text-amber-700">{createEntryError}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCreateEntry()}
                      disabled={creatingEntry}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {creatingEntry ? "Adding…" : "Add"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddEntry(false)}
                      disabled={creatingEntry}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Photos can be added once this entry is created — save it first, then use Take Photo / Upload Photo below.
                  </p>
                </div>
              ) : null}

              <div className="mt-4 space-y-3">
                {entriesLoading ? <p className="text-sm text-gray-600">Loading documentation…</p> : null}
                {entriesError ? <p className="text-sm font-semibold text-amber-700">{entriesError}</p> : null}
                {!entriesLoading && !entriesError && entries.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                    No documentation yet. Use “+ Add Documentation” to capture the first note or photo.
                  </p>
                ) : null}
                {!entriesLoading && !entriesError
                  ? entries.map((entry) => (
                      <DocumentationEntryCard
                        key={entry.id}
                        entry={entry}
                        projectId={projectId}
                        cardId={cardId}
                        canArchive={canArchive}
                        contributorLabel={contributorLabel}
                        onChanged={handleEntryChanged}
                      />
                    ))
                  : null}
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
              <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Developer Summary / Form-Build Notes</h2>
              <p className="mt-1 text-sm text-gray-600">
                Summarize what a real Installer Sheetz form for this product should eventually capture — components,
                mounting/wiring requirements, required photos, serial numbers, measurements, conditional questions,
                pass/fail checks, peripherals, proposed form sections, lessons learned.
              </p>
              <textarea
                value={developerSummary}
                onChange={(event) => {
                  setDeveloperSummary(event.target.value);
                  setSummarySaved(false);
                }}
                rows={10}
                className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
              />
              {summaryError ? <p className="mt-2 text-sm font-semibold text-amber-700">{summaryError}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleSaveSummary()}
                  disabled={savingSummary}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingSummary ? "Saving…" : "Save Developer Summary"}
                </button>
                {summarySaved ? <span className="text-sm font-semibold text-emerald-700">Saved</span> : null}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
