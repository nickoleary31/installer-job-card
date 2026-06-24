"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";

const JOB_CARD_DRAFTS_STORAGE_KEY = "installer-job-card-drafts-v1";
const JOB_CARD_RESUME_DRAFT_ID_KEY = "installer-job-card-resume-draft-id-v1";
const JOB_CARD_RESUME_DRAFT_PAYLOAD_KEY = "installer-job-card-resume-draft-payload-v1";
const JOB_CARD_DRAFTS_MIGRATION_KEY = "installer-job-card-drafts-submission-id-migrated-v1";
const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";

type StoredJobCardDraftListItem = {
  submissionId: string;
  id?: string;
  customer: string;
  unitNumber: string;
  savedAt: string;
  data?: Record<string, unknown> & {
    coreJob?: {
      location?: string;
    };
    hardwareSelection?: {
      primary?: string;
      additional?: string[];
    };
  };
};

type SupabaseDraftRow = {
  submission_id: string;
  customer: string | null;
  unit_number: string | null;
  payload: StoredJobCardDraftListItem["data"] | null;
  updated_at: string | null;
};

function readDrafts(): StoredJobCardDraftListItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(JOB_CARD_DRAFTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredJobCardDraftListItem[];
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.map((draft) => ({
      ...draft,
      submissionId: draft.submissionId || draft.id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }));
    const migrationDone = window.localStorage.getItem(JOB_CARD_DRAFTS_MIGRATION_KEY) === "1";
    if (!migrationDone) {
      window.localStorage.setItem(JOB_CARD_DRAFTS_STORAGE_KEY, JSON.stringify(migrated));
      window.localStorage.setItem(JOB_CARD_DRAFTS_MIGRATION_KEY, "1");
    }
    return migrated;
  } catch {
    return [];
  }
}

export default function DraftsPage() {
  const router = useRouter();
  const { loading: authLoading, context } = useAuthUserContext();
  const userId = context.userId;
  const [drafts, setDrafts] = useState<StoredJobCardDraftListItem[]>(() => readDrafts());
  const goToProjectDashboard = () => {
    if (typeof window !== "undefined") {
      const companyId = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
      const projectId = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
      if (companyId && projectId) {
        router.push(`/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}`);
        return;
      }
    }
    router.push("/home");
  };

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      router.replace("/login");
    }
  }, [authLoading, userId, router]);

  useEffect(() => {
    if (authLoading || !userId) return;
    let cancelled = false;
    const loadFromSupabase = async () => {
      try {
        const selectedCompanyId = (typeof window !== "undefined"
          ? window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)
          : "")?.trim() || "";
        const selectedProjectId = (typeof window !== "undefined"
          ? window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)
          : "")?.trim() || "";

        let query = supabase
          .from("job_card_drafts")
          .select("submission_id, customer, unit_number, payload, updated_at")
          .order("updated_at", { ascending: false });

        if (selectedCompanyId && selectedProjectId) {
          query = query.eq("company_id", selectedCompanyId).eq("project_id", selectedProjectId);
        }

        const { data, error } = await query;
        if (error) throw error;
        if (!data || cancelled) return;
        const mapped = (data as SupabaseDraftRow[]).map((row) => ({
          submissionId: row.submission_id,
          customer: row.customer?.trim() || "—",
          unitNumber: row.unit_number?.trim() || "—",
          savedAt: row.updated_at || new Date().toISOString(),
          data: row.payload ?? undefined,
        }));
        setDrafts(mapped);
        try {
          window.localStorage.setItem(JOB_CARD_DRAFTS_STORAGE_KEY, JSON.stringify(mapped));
        } catch {
          // ignore local cache write errors
        }
      } catch {
        // keep localStorage fallback already loaded into state
      }
    };
    loadFromSupabase();
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId]);

  const sortedDrafts = useMemo(
    () =>
      [...drafts].sort((a, b) => {
        const aTime = Date.parse(a.savedAt);
        const bTime = Date.parse(b.savedAt);
        return Number.isNaN(bTime) || Number.isNaN(aTime) ? 0 : bTime - aTime;
      }),
    [drafts],
  );

  const handleResume = (draft: StoredJobCardDraftListItem) => {
    try {
      const stableId = draft.submissionId || draft.id || "";
      window.localStorage.setItem(JOB_CARD_RESUME_DRAFT_ID_KEY, stableId);
      if (draft.data) {
        window.localStorage.setItem(
          JOB_CARD_RESUME_DRAFT_PAYLOAD_KEY,
          JSON.stringify({ submissionId: stableId, data: draft.data }),
        );
      } else {
        window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_PAYLOAD_KEY);
      }
    } catch {
      // ignore storage errors; fallback is opening form page
    }
    router.push("/new-submission");
  };

  const handleDelete = (submissionId: string) => {
    const next = drafts.filter((d) => (d.submissionId || d.id) !== submissionId);
    setDrafts(next);
    try {
      window.localStorage.setItem(JOB_CARD_DRAFTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore write errors
    }
  };

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-gray-600">Checking sign-in…</p>
      </main>
    );
  }

  if (!userId) {
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Installer Sheetz</h1>
          <p className="mt-1 text-sm text-gray-600">Digital Job Cards for Field Technicians</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goToProjectDashboard}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
            >
              Back
            </button>
            <Link
              href="/home"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
            >
              Back to Home Screen
            </Link>
          </div>
        </header>

        {sortedDrafts.length === 0 ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            No saved drafts yet
          </section>
        ) : (
          sortedDrafts.map((draft) => (
            <section
              key={draft.submissionId || draft.id}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
            >
              <div className="grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-gray-600">Customer:</span> {draft.customer || "—"}
                </p>
                <p>
                  <span className="font-semibold text-gray-600">Location:</span> {draft.data?.coreJob?.location?.trim() || "—"}
                </p>
                <p>
                  <span className="font-semibold text-gray-600">Unit #:</span> {draft.unitNumber || "—"}
                </p>
                <p>
                  <span className="font-semibold text-gray-600">Primary hardware:</span> {draft.data?.hardwareSelection?.primary?.trim() || "—"}
                </p>
                {Array.isArray(draft.data?.hardwareSelection?.additional) &&
                draft.data.hardwareSelection.additional.map((item) => item.trim()).filter(Boolean).length > 0 ? (
                  <p className="sm:col-start-2">
                    <span className="font-semibold text-gray-600">Additional hardware:</span>{" "}
                    {draft.data.hardwareSelection.additional.map((item) => item.trim()).filter(Boolean).join(", ")}
                  </p>
                ) : null}
                <p className="sm:col-span-2">
                  <span className="font-semibold text-gray-600">Last saved:</span>{" "}
                  {draft.savedAt ? new Date(draft.savedAt).toLocaleString() : "—"}
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  onClick={() => handleResume(draft)}
                >
                  Resume
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                  onClick={() => handleDelete(draft.submissionId || draft.id || "")}
                >
                  Delete
                </button>
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
