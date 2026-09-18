"use client";

/**
 * One Developer Sheets documentation entry: view/edit fields + its photos. Any authorized
 * project user (technician or admin) may edit the entry's fields; archive/restore is gated in
 * the UI to admins only (backend RLS + trigger remain the real authority either way).
 */
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { DocumentationPhotos } from "@/components/developer-sheets/DocumentationPhotos";
import type { DeveloperSheetDocumentationEntry } from "@/lib/developer-sheets/types";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export function DocumentationEntryCard({
  entry,
  projectId,
  cardId,
  canArchive,
  contributorLabel,
  onChanged,
}: {
  entry: DeveloperSheetDocumentationEntry;
  projectId: string;
  cardId: string;
  canArchive: boolean;
  contributorLabel: (userId: string | null) => string;
  onChanged: (updated: DeveloperSheetDocumentationEntry) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title || "");
  const [notes, setNotes] = useState(entry.notes || "");
  const [partNumber, setPartNumber] = useState(entry.part_number || "");
  const [tag, setTag] = useState(entry.tag || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { data, error } = await supabase
        .from("developer_sheet_documentation_entries")
        .update({
          title: title.trim() || null,
          notes: notes.trim() || null,
          part_number: partNumber.trim() || null,
          tag: tag.trim() || null,
        })
        .eq("id", entry.id)
        .select(
          "id, card_id, company_id, project_id, title, notes, part_number, tag, is_active, archived_at, archived_by, created_by, updated_by, created_at, updated_at",
        )
        .single<DeveloperSheetDocumentationEntry>();
      if (error) throw error;
      onChanged(data);
      setEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save documentation entry.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleArchive = async () => {
    setArchiving(true);
    setArchiveError(null);
    try {
      const { data, error } = await supabase
        .from("developer_sheet_documentation_entries")
        .update({ is_active: !entry.is_active })
        .eq("id", entry.id)
        .select(
          "id, card_id, company_id, project_id, title, notes, part_number, tag, is_active, archived_at, archived_by, created_by, updated_by, created_at, updated_at",
        )
        .single<DeveloperSheetDocumentationEntry>();
      if (error) throw error;
      onChanged(data);
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Failed to update archive state.");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <article
      className={`rounded-xl border p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        entry.is_active ? "border-gray-200 bg-gray-50" : "border-amber-200 bg-amber-50/60"
      }`}
    >
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-700">Title (optional)</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-700">Notes / Description</label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">Part Number (optional)</label>
              <input
                value={partNumber}
                onChange={(event) => setPartNumber(event.target.value)}
                className="w-full min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">Tag / Category (optional)</label>
              <input
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                placeholder="e.g. mounting, wiring"
                className="w-full min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
            </div>
          </div>
          {saveError ? <p className="text-sm font-semibold text-amber-700">{saveError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setTitle(entry.title || "");
                setNotes(entry.notes || "");
                setPartNumber(entry.part_number || "");
                setTag(entry.tag || "");
                setSaveError(null);
              }}
              disabled={saving}
              className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h4 className="text-sm font-bold text-gray-900">{entry.title?.trim() || "Untitled entry"}</h4>
            {!entry.is_active ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Archived</span>
            ) : null}
          </div>
          {entry.notes?.trim() ? <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{entry.notes.trim()}</p> : null}
          {(entry.part_number || entry.tag) ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.part_number ? (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">{entry.part_number}</span>
              ) : null}
              {entry.tag ? (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">{entry.tag}</span>
              ) : null}
            </div>
          ) : null}
          <p className="mt-2 text-xs text-gray-500">
            {contributorLabel(entry.created_by)} · {formatTimestamp(entry.created_at)}
            {entry.updated_by && entry.updated_at !== entry.created_at
              ? ` · edited by ${contributorLabel(entry.updated_by)} ${formatTimestamp(entry.updated_at)}`
              : ""}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
            >
              Edit
            </button>
            {canArchive ? (
              <button
                type="button"
                onClick={() => void handleToggleArchive()}
                disabled={archiving}
                className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {archiving ? "Working…" : entry.is_active ? "Archive" : "Restore"}
              </button>
            ) : null}
          </div>
          {archiveError ? <p className="mt-2 text-xs font-semibold text-amber-700">{archiveError}</p> : null}

          <DocumentationPhotos projectId={projectId} cardId={cardId} entryId={entry.id} />
        </>
      )}
    </article>
  );
}
