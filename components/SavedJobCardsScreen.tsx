"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { appRoutes } from "@/lib/app-routes";
import { setActiveProject } from "@/lib/active-project-context";
import { deleteLocalSubmissionDurably, getLocalSubmissionRepository, type LocalSubmission } from "@/lib/local-submission";
import { isNativeRuntime } from "@/lib/native/runtime";
import { TkpLogo } from "@/components/TkpLogo";

/**
 * Phase 2H — Saved Job Cards: LocalSubmission rows this device holds that
 * the technician has NOT yet explicitly submitted (technicianSubmittedAt ===
 * null — findUnsubmittedLocalSubmissions, deliberately regardless of
 * `status`, so a "locally-complete" reviewed-but-unsubmitted submission is
 * never hidden here either — see that repository method's own doc).
 *
 * SCOPE (explicitly decided, not an oversight): this screen is LOCAL-ONLY.
 * It does not read or import Cloud Drafts (job_card_drafts, the web app's
 * own online draft mechanism) — those remain a web-only concept with no
 * native equivalent in this phase. A technician who has both an old Cloud
 * Draft and native local submissions will only see the native ones here.
 */
type MinimalDraftPayload = { coreJob?: { customer?: string; unitNumber?: string } };

function draftDisplayName(payload: unknown): { customer: string; unitNumber: string } {
  const p = (payload as MinimalDraftPayload) || {};
  return {
    customer: p.coreJob?.customer?.trim() || "—",
    unitNumber: p.coreJob?.unitNumber?.trim() || "—",
  };
}

export function SavedJobCardsScreen({ companyId, projectId }: { companyId: string; projectId: string }) {
  const { loading: authLoading, context: userContext } = useAuthUserContext();
  const [submissions, setSubmissions] = useState<LocalSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (companyId && projectId) setActiveProject({ companyId, projectId });
  }, [companyId, projectId]);

  const fetchSubmissions = async (userId: string): Promise<LocalSubmission[]> => {
    return getLocalSubmissionRepository().findUnsubmittedLocalSubmissions(userId, projectId);
  };

  const reload = async () => {
    if (!userContext.userId) return;
    try {
      setSubmissions(await fetchSubmissions(userContext.userId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load saved job cards.");
      setSubmissions([]);
    }
  };

  useEffect(() => {
    if (authLoading || !userContext.userId || !isNativeRuntime()) return;
    const userId = userContext.userId;
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchSubmissions(userId);
        if (!cancelled) {
          setSubmissions(rows);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load saved job cards.");
          setSubmissions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, userContext.userId, projectId]);

  const handleResume = () => {
    setActiveProject({ companyId, projectId });
  };

  const handleDelete = async (localSubmissionId: string) => {
    setDeletingId(localSubmissionId);
    try {
      await deleteLocalSubmissionDurably(localSubmissionId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this saved job card.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-5 sm:py-2">
        <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <TkpLogo priority />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Saved Job Cards</h1>
          <p className="text-sm text-gray-600">
            Native Saved Job Cards currently represents drafts saved on this device. Existing Cloud Drafts remain
            available through the web workflow.
          </p>
          <Link
            href={appRoutes.project(companyId, projectId)}
            className="mt-3 inline-flex text-sm font-semibold text-blue-700 hover:underline"
          >
            Back to project
          </Link>
        </header>

        {!isNativeRuntime() ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            Saved Job Cards is only available in the installed app.
          </section>
        ) : authLoading || submissions === null ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            Loading…
          </section>
        ) : error ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            {error}
          </section>
        ) : submissions.length === 0 ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            No saved job cards on this device for this project.
          </section>
        ) : (
          <div className="space-y-3">
            {submissions.map((submission) => {
              const { customer, unitNumber } = draftDisplayName(submission.payload);
              return (
                <article
                  key={submission.localSubmissionId}
                  className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">{customer}</h2>
                      <p className="text-sm text-gray-600">Unit {unitNumber}</p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {submission.status === "locally-complete" ? "Ready to submit" : "In progress"}
                      </p>
                      <p className="text-xs text-gray-400">Last saved {new Date(submission.updatedAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-3">
                    <Link
                      href={appRoutes.newSubmission()}
                      onClick={handleResume}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Resume
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleDelete(submission.localSubmissionId)}
                      disabled={deletingId === submission.localSubmissionId}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingId === submission.localSubmissionId ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
