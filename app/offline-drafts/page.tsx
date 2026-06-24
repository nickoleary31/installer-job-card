"use client";

/* Full-document <a href> navigation is required for reliable offline/PWA replay (Next <Link> prefetch/router is not). */

import { useCallback, useEffect, useState } from "react";
import {
  INSTALLER_OFFLINE_DRAFT_ID_KEY,
  deleteOfflineJobCardDraft,
  getAllOfflineJobCardDrafts,
  type OfflineJobCardDraftRecord,
} from "@/lib/offline-job-card-drafts";

function customerOrProjectName(row: OfflineJobCardDraftRecord<unknown>): string {
  const cust = row.customer?.trim();
  if (cust) return cust;
  const pn = row.projectName?.trim();
  if (pn) return pn;
  const d = row.data as { coreJob?: { customer?: string } } | undefined;
  const fromData = d?.coreJob?.customer?.trim();
  if (fromData) return fromData;
  return "—";
}

function unitFromRow(row: OfflineJobCardDraftRecord<unknown>): string {
  const m = row.unitNumber?.trim();
  if (m) return m;
  const d = row.data as { coreJob?: { unitNumber?: string } } | undefined;
  return d?.coreJob?.unitNumber?.trim() || "—";
}

function sectionsFromRow(row: OfflineJobCardDraftRecord<unknown>): string {
  const fromRow = row.selectedSections?.filter(Boolean);
  if (fromRow && fromRow.length > 0) return fromRow.join(", ");
  return "—";
}

export default function OfflineDraftsPage() {
  const [drafts, setDrafts] = useState<OfflineJobCardDraftRecord<unknown>[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadDrafts = useCallback(() => {
    void (async () => {
      try {
        const list = await getAllOfflineJobCardDrafts<unknown>();
        setDrafts(list);
        setLoadError(null);
      } catch {
        setLoadError("Could not read saved job cards from this device.");
      }
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    loadDrafts();
  }, [loadDrafts]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") loadDrafts();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadDrafts]);

  const handleDelete = async (offlineDraftId: string) => {
    setDeletingId(offlineDraftId);
    try {
      await deleteOfflineJobCardDraft(offlineDraftId);
      setDrafts((prev) => prev.filter((d) => d.offlineDraftId !== offlineDraftId));
      setLoadError(null);
    } catch {
      setLoadError("Could not delete that job card.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 pb-24 sm:px-5">
      <div className="mx-auto max-w-2xl space-y-5">
        <header>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="/home" className="text-sm font-semibold text-blue-700 hover:underline">
              ← Home
            </a>
            <a href="/installs" className="text-sm font-semibold text-blue-700 hover:underline">
              Installs
            </a>
            <a href="/new-submission" className="text-sm font-semibold text-blue-700 hover:underline">
              New submission
            </a>
          </p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">Saved on this device</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Job cards stored only in this browser. Open once online if the app shell is not cached yet.
          </p>
        </header>

        {loadError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
            {loadError}
          </div>
        ) : null}

        {drafts.length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-600 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300">
            No saved job cards on this device
          </p>
        ) : (
          <ul className="space-y-3">
            {drafts.map((row) => {
              const savedLabel = row.savedAt ? new Date(row.savedAt).toLocaleString() : "—";
              return (
                <li
                  key={row.offlineDraftId}
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900 sm:p-5"
                >
                  <div className="space-y-1 text-sm text-gray-800 dark:text-gray-100">
                    <p className="font-semibold text-gray-900 dark:text-gray-50">{customerOrProjectName(row)}</p>
                    <p>
                      <span className="text-gray-500 dark:text-gray-400">Unit: </span>
                      {unitFromRow(row)}
                    </p>
                    <p>
                      <span className="text-gray-500 dark:text-gray-400">Hardware sections: </span>
                      {sectionsFromRow(row)}
                    </p>
                    <p>
                      <span className="text-gray-500 dark:text-gray-400">Saved: </span>
                      {savedLabel}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a
                      href="/new-submission"
                      className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      onClick={() => {
                        try {
                          window.localStorage.setItem(INSTALLER_OFFLINE_DRAFT_ID_KEY, row.offlineDraftId);
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      Resume
                    </a>
                    <button
                      type="button"
                      disabled={deletingId === row.offlineDraftId}
                      onClick={() => void handleDelete(row.offlineDraftId)}
                      className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:bg-slate-900 dark:text-red-200 dark:hover:bg-red-950/40"
                    >
                      {deletingId === row.offlineDraftId ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
