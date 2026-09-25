"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { apiUrl } from "@/lib/api-base";
import { appRoutes } from "@/lib/app-routes";
import { setActiveProject } from "@/lib/active-project-context";
import {
  getLocalSubmissionOutboxRepository,
  resolveSubmittedDisplayStatus,
  resolveSubmittedRowAction,
  type LocalSubmissionOutboxEntry,
  type SubmittedDisplayStatus,
  type SubmittedRowAction,
} from "@/lib/local-submission-outbox";
import { getNetworkStatus } from "@/lib/native/network-status";
import { isNativeRuntime } from "@/lib/native/runtime";
import { runForegroundSync } from "@/lib/submission-sync";
import { supabase } from "@/lib/supabase/client";
import type { JobCardSubmissionPayload } from "@/lib/job-card-submission";
import { TkpLogo } from "@/components/TkpLogo";

type ServerHistoryRow = {
  submissionId: string;
  submissionSnapshotHash: string | null;
  customer: string | null;
  unitNumber: string | null;
  technicianSubmittedAt: string | null;
  createdAt: string;
};

type MergedRow = {
  submissionId: string;
  customer: string;
  unitNumber: string;
  sortAt: string;
  displayStatus: SubmittedDisplayStatus;
  lastError: string | null;
  /** See resolveSubmittedRowAction — non-null only when the sync engine would actually claim this row. */
  action: SubmittedRowAction | null;
};

const STATUS_BADGE_CLASSES: Record<SubmittedDisplayStatus, string> = {
  Synced: "bg-emerald-100 text-emerald-800",
  Syncing: "bg-blue-100 text-blue-800",
  "Local only": "bg-gray-100 text-gray-700",
  "Sync failed": "bg-orange-100 text-orange-800",
  "Needs attention": "bg-rose-100 text-rose-800",
  "Authorization required": "bg-amber-100 text-amber-800",
};

/** Plain-language next step for each state that isn't simply done or in progress. */
function guidanceFor(status: SubmittedDisplayStatus): string | null {
  switch (status) {
    case "Sync failed":
      return "It will try again automatically when you're online, or tap Retry.";
    case "Needs attention":
      return "Retrying won't fix this, so there's no Retry. The job card is still saved on this device — contact your admin.";
    case "Authorization required":
      return "Your access to this project couldn't be confirmed. Sign in again, or check with your admin that you're still assigned to this project. The job card is still saved on this device.";
    default:
      return null;
  }
}

/**
 * Phase 2H — Submitted: the merge of THIS device's outbox entries for this
 * project with the project's canonical server history (GET
 * /api/job-card-submissions — never a direct native query against
 * job_card_submissions, which has no client-facing RLS policies at all —
 * see that route's own doc). A canonical server submission with no local
 * outbox row on this device (submitted from elsewhere, or the legacy web
 * path) still appears here, correctly as Synced — see
 * resolveSubmittedDisplayStatus's own doc for the full status derivation,
 * including why a matching submission_id alone is never sufficient for
 * "Synced" (the server's own submissionSnapshotHash must match too).
 */
/** Pure fetch — no setState — so the mount effect and the manual Retry/Recheck Access handler share exactly one code path. */
async function fetchMergedRows(userId: string, companyId: string, projectId: string): Promise<{ merged: MergedRow[]; fetchedServer: boolean }> {
  const outboxEntries: LocalSubmissionOutboxEntry<JobCardSubmissionPayload>[] = isNativeRuntime()
    ? (await getLocalSubmissionOutboxRepository().listAllOutboxEntriesForUser<JobCardSubmissionPayload>(userId)).filter(
        (e) => e.projectId === projectId,
      )
    : [];

  let serverRows: ServerHistoryRow[] = [];
  let fetchedServer = false;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (accessToken) {
      const res = await fetch(
        apiUrl(`/api/job-card-submissions?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(projectId)}`),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.ok) {
        const body = (await res.json()) as { submissions?: ServerHistoryRow[] };
        serverRows = body.submissions || [];
        fetchedServer = true;
      }
    }
  } catch {
    // offline or unreachable — fall back to local-only knowledge below
  }

  const serverBySubmissionId = new Map(serverRows.map((r) => [r.submissionId, r]));
  const merged: MergedRow[] = [];
  const seen = new Set<string>();

  for (const entry of outboxEntries) {
    const server = serverBySubmissionId.get(entry.localSubmissionId) || null;
    const customer = server?.customer || entry.snapshotPayload?.coreJobInfo?.customer || "—";
    const unitNumber = server?.unitNumber || entry.snapshotPayload?.coreJobInfo?.unitNumber || "—";
    merged.push({
      submissionId: entry.localSubmissionId,
      customer,
      unitNumber,
      sortAt: entry.snapshotTechnicianSubmittedAt,
      displayStatus: resolveSubmittedDisplayStatus(entry, server?.submissionSnapshotHash),
      lastError: entry.syncState === "failed" ? entry.lastError : null,
      action: resolveSubmittedRowAction(entry),
    });
    seen.add(entry.localSubmissionId);
  }
  for (const server of serverRows) {
    if (seen.has(server.submissionId)) continue;
    merged.push({
      submissionId: server.submissionId,
      customer: server.customer || "—",
      unitNumber: server.unitNumber || "—",
      sortAt: server.technicianSubmittedAt || server.createdAt,
      displayStatus: resolveSubmittedDisplayStatus(null, server.submissionSnapshotHash),
      lastError: null,
      action: null,
    });
  }
  merged.sort((a, b) => (a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : 0));

  return { merged, fetchedServer };
}

export function SubmittedJobCardsScreen({ companyId, projectId }: { companyId: string; projectId: string }) {
  const { loading: authLoading, context: userContext } = useAuthUserContext();
  const [rows, setRows] = useState<MergedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (companyId && projectId) setActiveProject({ companyId, projectId, userId: userContext.userId });
  }, [companyId, projectId, userContext.userId]);

  useEffect(() => {
    if (authLoading || !userContext.userId) return;
    const userId = userContext.userId;
    let cancelled = false;
    (async () => {
      try {
        const { merged, fetchedServer } = await fetchMergedRows(userId, companyId, projectId);
        if (cancelled) return;
        setRows(merged);
        setOfflineNotice(!fetchedServer);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load submitted job cards.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, userContext.userId, companyId, projectId]);

  /**
   * The functional Retry / Recheck Access / Sync now action — invokes the
   * SAME lib/submission-sync.ts engine ForegroundSyncMount uses, never a
   * decorative status-only button. Checkpoint 1: a row only gets a button
   * when resolveSubmittedRowAction says the engine would actually claim it
   * (retryable "Sync failed", "Authorization required", and "Local only"
   * pending rows); terminal "Needs attention" rows get an explanation and no
   * button. Deliberately re-syncs every claimable entry for this user in one
   * pass (not just the row tapped): the engine's claim/finalize logic already
   * has to load the full claimable set, and a technician with several stuck
   * items benefits from one tap fixing all of them rather than needing to
   * retry each individually. Authorization revalidation happens inside the
   * engine itself, server-side, as the first network call for that entry
   * (see lib/submission-sync.ts's own doc) — this handler never uploads/
   * finalizes before that check.
   */
  const handleSyncAction = async () => {
    if (!userContext.userId || syncingNow) return;
    setActionMessage(null);
    setSyncingNow(true);
    try {
      const online = await getNetworkStatus().isOnlineFresh();
      if (!online) {
        setActionMessage("Still offline — this will sync automatically once you're back online.");
        return;
      }
      await runForegroundSync(userContext.userId);
      const { merged, fetchedServer } = await fetchMergedRows(userContext.userId, companyId, projectId);
      setRows(merged);
      setOfflineNotice(!fetchedServer);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Sync attempt failed.");
    } finally {
      setSyncingNow(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-5 sm:py-2">
        <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <TkpLogo priority />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Submitted Job Cards</h1>
          <Link
            href={appRoutes.project(companyId, projectId)}
            className="mt-3 inline-flex text-sm font-semibold text-blue-700 hover:underline"
          >
            Back to project
          </Link>
        </header>

        {offlineNotice ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            Offline — showing what this device knows. Submissions made from other devices may not be shown until
            you&apos;re back online.
          </section>
        ) : null}

        {actionMessage ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            {actionMessage}
          </section>
        ) : null}

        {authLoading || rows === null ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            Loading…
          </section>
        ) : error ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            {error}
          </section>
        ) : rows.length === 0 ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            No submitted job cards for this project yet.
          </section>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <article
                key={row.submissionId}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">{row.customer}</h2>
                    <p className="text-sm text-gray-600">Unit {row.unitNumber}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${STATUS_BADGE_CLASSES[row.displayStatus]}`}>
                    {row.displayStatus}
                  </span>
                </div>
                {row.lastError ? <p className="mt-2 text-xs text-rose-700">{row.lastError}</p> : null}
                {guidanceFor(row.displayStatus) ? (
                  <p className="mt-1 text-xs text-gray-600">{guidanceFor(row.displayStatus)}</p>
                ) : null}
                {row.action ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => void handleSyncAction()}
                      disabled={syncingNow}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {syncingNow ? "Syncing…" : row.action}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
