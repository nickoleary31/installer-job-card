"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

const JOB_CARD_DRAFTS_STORAGE_KEY = "installer-job-card-drafts-v1";
const JOB_CARD_RESUME_DRAFT_ID_KEY = "installer-job-card-resume-draft-id-v1";
const JOB_CARD_RESUME_DRAFT_PAYLOAD_KEY = "installer-job-card-resume-draft-payload-v1";
const JOB_CARD_DRAFTS_MIGRATION_KEY = "installer-job-card-drafts-submission-id-migrated-v1";

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
  const [drafts, setDrafts] = useState<StoredJobCardDraftListItem[]>(() => readDrafts());

  useEffect(() => {
    let cancelled = false;
    const loadFromSupabase = async () => {
      try {
        const { data, error } = await supabase
          .from("job_card_drafts")
          .select("submission_id, customer, unit_number, payload, updated_at")
          .order("updated_at", { ascending: false });
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
  }, []);

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

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Saved Drafts</h1>
          <p className="mt-1 text-sm text-gray-600">Resume or delete unfinished job cards</p>
          <Link
            href="/"
            className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
          >
            Back to Home Screen
          </Link>
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
