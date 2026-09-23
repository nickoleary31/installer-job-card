"use client";

import { useEffect, useState } from "react";
import { getActiveProjectsFieldPackage, type FieldPackageProject } from "@/lib/active-projects-field-package";
import { clearLease, issueOrRefreshLease, loadLease } from "@/lib/auth/offline-access-lease";
import { apiUrl } from "@/lib/api-base";
import { getNetworkStatus } from "@/lib/native/network-status";
import { getProjectWorkPackageRepository } from "@/lib/project-work-package";
import { getCompanyProductDefinitionsRepository, type CompanyFormProductRow } from "@/lib/product-config";
import { getLocalSubmissionRepository, type LocalSubmissionInput } from "@/lib/local-submission";
import { deleteLocalPhotoDurably, getLocalPhotoMetadataRepository, loadLocalPhotoBlob, savePhotoDurably } from "@/lib/local-photo";
import {
  clearProofMarkers,
  readProofMarkers,
  writeProofMarkers,
  type ProofReadResult,
  type ProofWriteResult,
} from "@/lib/native/persistence-proof";

/**
 * Phase 2E — a synthetic custom product for synthetic-company-1, same shape/pattern
 * proven by lib/product-config/resolve-company-products.test.ts's "DB-only company"
 * case: a company-specific product riding the "ppd" base form.
 */
const SYNTHETIC_COMPANY_PRODUCTS: CompanyFormProductRow[] = [
  {
    id: "synthetic-product-1",
    company_id: "synthetic-company-1",
    product_key: "synthetic_ppd",
    display_label: "Synthetic Pedestrian Detector",
    base_form_id: "ppd",
    section_key: "synthetic_ppd",
    submission_type: "synthetic_ppd",
    draft_key: "synthetic_ppd",
    allow_primary: true,
    allow_additional: false,
    active: true,
    display_order: 1,
    configuration: {},
  },
];

/**
 * Phase 2B field-package proof — clearly synthetic user ids and project
 * data, never written to Supabase/Production. USER_A_SET_2 deliberately
 * drops one project from SET_1 and adds a new one, so "write set 1, then
 * write set 2" exercises the transactional replace path (stale rows from
 * set 1 must not survive alongside set 2's rows).
 */
const USER_A = "phase2b-synthetic-user-a";
const USER_B = "phase2b-synthetic-user-b";

/** Phase 2F — synthetic structured payload, same StoredJobCardDraft["data"] shape NewSubmissionForm.tsx produces. */
const SYNTHETIC_LOCAL_SUBMISSION_INPUT: LocalSubmissionInput<{
  coreJob: { customer: string; unitNumber: string };
  hardwareSelection: { primary: string; hasAdditional: string; additional: string[] };
}> = {
  localSubmissionId: "synthetic-local-submission-1",
  userId: USER_A,
  projectId: "synthetic-project-1",
  companyId: "synthetic-company-1",
  status: "working",
  formId: "vac4",
  submissionType: "VAC4",
  definitionSchemaVersion: 1,
  selectedSections: ["VAC4"],
  payload: {
    coreJob: { customer: "Synthetic Customer", unitNumber: "UNIT-001" },
    hardwareSelection: { primary: "VAC4", hasAdditional: "No", additional: [] },
  },
  serverSubmissionId: null,
};

const USER_A_SET_1: FieldPackageProject[] = [
  {
    projectId: "synthetic-project-1",
    companyId: "synthetic-company-1",
    companyName: "Synthetic Co",
    projectName: "Synthetic Install #1",
    displayCustomerName: "Synthetic Customer",
    displayLocation: "1 Synthetic St",
    completedSubmissionCount: 0,
    active: true,
  },
  {
    projectId: "synthetic-project-2",
    companyId: "synthetic-company-1",
    companyName: "Synthetic Co",
    projectName: "Synthetic Install #2",
    displayCustomerName: "Synthetic Customer",
    displayLocation: "2 Synthetic St",
    completedSubmissionCount: 1,
    active: true,
  },
];

const USER_A_SET_2: FieldPackageProject[] = [
  USER_A_SET_1[0],
  {
    projectId: "synthetic-project-3",
    companyId: "synthetic-company-1",
    companyName: "Synthetic Co",
    projectName: "Synthetic Install #3 (replaces #2)",
    displayCustomerName: "Synthetic Customer",
    displayLocation: "3 Synthetic St",
    completedSubmissionCount: 0,
    active: true,
  },
];

/** Phase 2G — a tiny (1x1 transparent) real PNG, so savePhotoDurably()/loadLocalPhotoBlob() exercise real filesystem bytes, not a fake string. */
function syntheticPhotoBlob(): Blob {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

/** Phase 2G cleanup pass — byte-for-byte identity check for the authorization-removal/logout preservation proofs below (SHA-256, not just size). */
async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Phase 2F item 1 — simulates a successful authoritative refresh where project-1 drops out of User A's authorized set entirely (project-2 remains). */
const USER_A_SET_WITHOUT_PROJECT_1: FieldPackageProject[] = [
  {
    projectId: "synthetic-project-2",
    companyId: "synthetic-company-1",
    companyName: "Synthetic Co",
    projectName: "Synthetic Install #2",
    displayCustomerName: "Synthetic Customer",
    displayLocation: "2 Synthetic St",
    completedSubmissionCount: 1,
    active: true,
  },
];

const USER_B_SET_1: FieldPackageProject[] = [
  {
    projectId: "synthetic-project-b1",
    companyId: "synthetic-company-2",
    companyName: "Other Synthetic Co",
    projectName: "User B Install",
    displayCustomerName: "User B Customer",
    displayLocation: "1 Other St",
    completedSubmissionCount: 0,
    active: true,
  },
];

/**
 * Phase 2A diagnostics only — not linked from any technician navigation or
 * appRoutes entry. Reachable only by opening this path directly inside the
 * packaged native shell, to manually prove the SQLite/Filesystem/secure-storage
 * adapters survive a real force-close/reopen. Never touches Production data.
 *
 * Manual test procedure:
 * 1. Tap "Write markers", confirm all three show ok.
 * 2. Force-close the app (not just background it), reopen, return here.
 * 3. Tap "Read markers" — values must match the marker shown after step 1.
 * 4. Tap "Clear markers" to remove the test data when done.
 *
 * The "Live network status" line subscribes to NetworkStatus on mount —
 * without a live subscriber, nothing ever calls subscribe() and the cached
 * isOnline() value would stay frozen at whatever it was on first read.
 */
type FieldPackageLogEntry = { at: string; action: string; result: unknown };

export default function NativeProofPage() {
  const [writeResult, setWriteResult] = useState<ProofWriteResult | null>(null);
  const [readResult, setReadResult] = useState<ProofReadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveOnline, setLiveOnline] = useState<boolean | null>(null);
  const [fieldPackageLog, setFieldPackageLog] = useState<FieldPackageLogEntry[]>([]);
  const [lastLocalPhotoId, setLastLocalPhotoId] = useState<string | null>(null);
  const [secondLocalPhotoId, setSecondLocalPhotoId] = useState<string | null>(null);
  const [queryLocalSubmissionId, setQueryLocalSubmissionId] = useState("");
  const [queryLocalPhotoId, setQueryLocalPhotoId] = useState("");

  useEffect(() => {
    const status = getNetworkStatus();
    setLiveOnline(status.isOnline());
    return status.subscribe((online) => setLiveOnline(online));
  }, []);

  async function handleWrite() {
    setBusy(true);
    try {
      setWriteResult(await writeProofMarkers());
    } finally {
      setBusy(false);
    }
  }

  async function handleRead() {
    setBusy(true);
    try {
      setReadResult(await readProofMarkers());
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setBusy(true);
    try {
      await clearProofMarkers();
      setWriteResult(null);
      setReadResult(null);
    } finally {
      setBusy(false);
    }
  }

  function logFieldPackage(action: string, result: unknown) {
    setFieldPackageLog((prev) => [{ at: new Date().toISOString(), action, result }, ...prev].slice(0, 20));
  }

  async function runFieldPackage(action: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      const result = await fn();
      logFieldPackage(action, result ?? "ok");
    } catch (e) {
      logFieldPackage(action, { error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const pkg = () => getActiveProjectsFieldPackage();

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-6 dark:bg-slate-950 sm:px-5">
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Phase 2A native persistence proof
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Diagnostics only. Not part of the technician workflow.
        </p>
        <p className="text-sm text-slate-800 dark:text-slate-200">
          Live network status:{" "}
          <span className="font-mono">{liveOnline === null ? "checking…" : liveOnline ? "online" : "offline"}</span>
        </p>

        <hr className="border-slate-300 dark:border-slate-700" />

        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Phase 2H — packaged app → local API connectivity proof
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Unauthenticated fetch to apiUrl(&quot;/api/job-card-submissions&quot;) — proves the bundled WebView can
          reach NEXT_PUBLIC_API_ORIGIN while still loading its own UI from packaged Capacitor assets. Expects a 401
          (route reached, auth required), not a network-level failure.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("fetch apiUrl(/api/job-card-submissions)", async () => {
                const target = apiUrl("/api/job-card-submissions?companyId=connectivity-check&projectId=connectivity-check");
                try {
                  const res = await fetch(target);
                  const body = await res.text();
                  return { target, status: res.status, body: body.slice(0, 300) };
                } catch (e) {
                  return { target, networkError: e instanceof Error ? e.message : String(e) };
                }
              })
            }
            className="rounded bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Test local API connectivity
          </button>
        </div>

        <hr className="border-slate-300 dark:border-slate-700" />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleWrite}
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Write markers
          </button>
          <button
            type="button"
            onClick={handleRead}
            disabled={busy}
            className="rounded bg-slate-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Read markers
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="rounded bg-slate-300 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          >
            Clear markers
          </button>
        </div>
        {writeResult && (
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Write result</h2>
            <pre className="overflow-x-auto rounded bg-white p-3 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
              {JSON.stringify(writeResult, null, 2)}
            </pre>
          </div>
        )}
        {readResult && (
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Read result</h2>
            <pre className="overflow-x-auto rounded bg-white p-3 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
              {JSON.stringify(readResult, null, 2)}
            </pre>
          </div>
        )}

        <hr className="border-slate-300 dark:border-slate-700" />

        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Phase 2B active-projects field package proof
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Synthetic user ids/projects only ({USER_A}, {USER_B}) — never written to Supabase/Production.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => runFieldPackage("save(A, set1)", () => pkg().saveActiveProjectsSnapshot(USER_A, USER_A_SET_1))}
            className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Save User A — set 1
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runFieldPackage("save(A, set2 — replace)", () => pkg().saveActiveProjectsSnapshot(USER_A, USER_A_SET_2))}
            className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Save User A — set 2 (replace)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("save(A, set WITHOUT project-1 — authorization removed)", () =>
                pkg().saveActiveProjectsSnapshot(USER_A, USER_A_SET_WITHOUT_PROJECT_1),
              )
            }
            className="rounded bg-red-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Save User A — drop project-1 (Phase 2F item 1)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runFieldPackage("load(A)", () => pkg().loadActiveProjectsSnapshot(USER_A))}
            className="rounded bg-slate-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Load User A
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runFieldPackage("metadata(A)", () => pkg().getSnapshotMetadata(USER_A))}
            className="rounded bg-slate-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Metadata User A
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runFieldPackage("clear(A)", () => pkg().clearSnapshotForUser(USER_A))}
            className="rounded bg-slate-300 px-3 py-2 text-xs font-medium text-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          >
            Clear User A
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => runFieldPackage("save(B, set1)", () => pkg().saveActiveProjectsSnapshot(USER_B, USER_B_SET_1))}
            className="rounded bg-purple-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Save User B — set 1
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runFieldPackage("load(B)", () => pkg().loadActiveProjectsSnapshot(USER_B))}
            className="rounded bg-slate-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Load User B
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runFieldPackage("clear(B)", () => pkg().clearSnapshotForUser(USER_B))}
            className="rounded bg-slate-300 px-3 py-2 text-xs font-medium text-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          >
            Clear User B
          </button>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Field package action log</h2>
          <pre className="max-h-96 overflow-auto rounded bg-white p-3 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
            {JSON.stringify(fieldPackageLog, null, 2)}
          </pre>
        </div>

        <hr className="border-slate-300 dark:border-slate-700" />

        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Phase 2C offline access lease proof
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Exercises the real secure-storage-backed 7-day OfflineAccessLease with the same synthetic user ids as the
          field-package proof above ({USER_A}, {USER_B}). Leasing User A here plus saving User A&apos;s field
          package above is what lets /installs enter offline-authorized mode for User A while offline.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("issueOrRefreshLease(A)", () =>
                issueOrRefreshLease({ userId: USER_A, displayName: "Synthetic User A", email: "user-a@example.test" }),
              )
            }
            className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Lease User A
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("issueOrRefreshLease(B)", () =>
                issueOrRefreshLease({ userId: USER_B, displayName: "Synthetic User B", email: "user-b@example.test" }),
              )
            }
            className="rounded bg-purple-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Lease User B
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runFieldPackage("loadLease()", () => loadLease())}
            className="rounded bg-slate-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Load lease
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runFieldPackage("clearLease()", () => clearLease())}
            className="rounded bg-slate-300 px-3 py-2 text-xs font-medium text-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          >
            Clear lease
          </button>
        </div>

        <hr className="border-slate-300 dark:border-slate-700" />

        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Phase 2D project work package proof
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Exercises the real SQLite-backed Project Work Package for synthetic-project-1 (already present in User
          A&apos;s Active Projects field package above), plus a second synthetic project to prove per-project
          isolation.
        </p>

        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Phase 2D.1 — proactive provisioning proof
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Calls provisionProjectWorkPackages() directly — the exact SAME production function
          ActiveProjectsScreen.tsx calls right after a successful Active Projects sync — NOT the single-package
          saveProjectWorkPackage() below. Neither project&apos;s Project Detail screen is ever opened here.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("provisionProjectWorkPackages(A: project-1 + project-2)", () =>
                getProjectWorkPackageRepository().provisionProjectWorkPackages(USER_A, [
                  {
                    userId: USER_A,
                    projectId: "synthetic-project-1",
                    companyId: "synthetic-company-1",
                    companyName: "Synthetic Co",
                    projectName: "Synthetic Install #1",
                    customerName: "Synthetic Customer",
                    customerAccountName: null,
                    location: "1 Synthetic St",
                    primaryContact: null,
                    contactNumber: null,
                    contactEmail: null,
                    zohoLinked: false,
                    zohoWorkOrderNumber: null,
                    zohoServiceAppointmentNumber: null,
                    zohoSummary: null,
                  },
                  {
                    userId: USER_A,
                    projectId: "synthetic-project-2",
                    companyId: "synthetic-company-1",
                    companyName: "Synthetic Co",
                    projectName: "Synthetic Install #2",
                    customerName: "Synthetic Customer",
                    customerAccountName: null,
                    location: "2 Synthetic St",
                    primaryContact: null,
                    contactNumber: null,
                    contactEmail: null,
                    zohoLinked: false,
                    zohoWorkOrderNumber: null,
                    zohoServiceAppointmentNumber: null,
                    zohoSummary: null,
                  },
                ]),
              )
            }
            className="rounded bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Provision (A: project-1 + project-2)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("provisionProjectWorkPackages(A: project-1 ONLY)", () =>
                getProjectWorkPackageRepository().provisionProjectWorkPackages(USER_A, [
                  {
                    userId: USER_A,
                    projectId: "synthetic-project-1",
                    companyId: "synthetic-company-1",
                    companyName: "Synthetic Co",
                    projectName: "Synthetic Install #1",
                    customerName: "Synthetic Customer",
                    customerAccountName: null,
                    location: "1 Synthetic St",
                    primaryContact: null,
                    contactNumber: null,
                    contactEmail: null,
                    zohoLinked: false,
                    zohoWorkOrderNumber: null,
                    zohoServiceAppointmentNumber: null,
                    zohoSummary: null,
                  },
                ]),
              )
            }
            className="rounded bg-amber-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Re-provision (A: project-1 ONLY — drops project-2)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("provisionProjectWorkPackages(A: project-2 ONLY — drops project-1, Phase 2F item 1)", () =>
                getProjectWorkPackageRepository().provisionProjectWorkPackages(USER_A, [
                  {
                    userId: USER_A,
                    projectId: "synthetic-project-2",
                    companyId: "synthetic-company-1",
                    companyName: "Synthetic Co",
                    projectName: "Synthetic Install #2",
                    customerName: "Synthetic Customer",
                    customerAccountName: null,
                    location: "2 Synthetic St",
                    primaryContact: null,
                    contactNumber: null,
                    contactEmail: null,
                    zohoLinked: false,
                    zohoWorkOrderNumber: null,
                    zohoServiceAppointmentNumber: null,
                    zohoSummary: null,
                  },
                ]),
              )
            }
            className="rounded bg-red-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Re-provision (A: project-2 ONLY — drops project-1, Phase 2F item 1)
          </button>
        </div>

        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Single-package save/load/clear (simulates an online Project Detail visit&apos;s own enrichment save)
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("saveProjectWorkPackage(A, project-1)", () =>
                getProjectWorkPackageRepository().saveProjectWorkPackage({
                  userId: USER_A,
                  projectId: "synthetic-project-1",
                  companyId: "synthetic-company-1",
                  companyName: "Synthetic Co",
                  projectName: "Synthetic Install #1",
                  customerName: "Synthetic Customer",
                  customerAccountName: null,
                  location: "1 Synthetic St",
                  primaryContact: "Synthetic Contact",
                  contactNumber: "555-0100",
                  contactEmail: "contact@synthetic.example",
                  zohoLinked: true,
                  zohoWorkOrderNumber: "WO-0001",
                  zohoServiceAppointmentNumber: "SA-0001",
                  zohoSummary: "Synthetic install summary",
                }),
              )
            }
            className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Save package (A, project-1)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("saveProjectWorkPackage(A, project-2)", () =>
                getProjectWorkPackageRepository().saveProjectWorkPackage({
                  userId: USER_A,
                  projectId: "synthetic-project-2",
                  companyId: "synthetic-company-1",
                  companyName: "Synthetic Co",
                  projectName: "Synthetic Install #2",
                  customerName: "Synthetic Customer",
                  customerAccountName: null,
                  location: "2 Synthetic St",
                  primaryContact: null,
                  contactNumber: null,
                  contactEmail: null,
                  zohoLinked: false,
                  zohoWorkOrderNumber: null,
                  zohoServiceAppointmentNumber: null,
                  zohoSummary: null,
                }),
              )
            }
            className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Save package (A, project-2)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("loadProjectWorkPackage(A, project-1)", () =>
                getProjectWorkPackageRepository().loadProjectWorkPackage(USER_A, "synthetic-project-1"),
              )
            }
            className="rounded bg-slate-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Load package (A, project-1)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("loadProjectWorkPackage(B, project-1)", () =>
                getProjectWorkPackageRepository().loadProjectWorkPackage(USER_B, "synthetic-project-1"),
              )
            }
            className="rounded bg-purple-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Load package (B, project-1)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("clearProjectWorkPackage(A, project-1)", () =>
                getProjectWorkPackageRepository().clearProjectWorkPackage(USER_A, "synthetic-project-1"),
              )
            }
            className="rounded bg-slate-300 px-3 py-2 text-xs font-medium text-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          >
            Clear package (A, project-1)
          </button>
        </div>

        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Phase 2E — company product definitions (real saveCompanyProductDefinitions, synthetic rows)
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("saveCompanyProductDefinitions(synthetic-company-1: 1 row)", () =>
                getCompanyProductDefinitionsRepository().saveCompanyProductDefinitions(
                  "synthetic-company-1",
                  SYNTHETIC_COMPANY_PRODUCTS,
                ),
              )
            }
            className="rounded bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Provision company products (synthetic-company-1)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("loadCompanyProductDefinitions(synthetic-company-1)", () =>
                getCompanyProductDefinitionsRepository().loadCompanyProductDefinitions("synthetic-company-1"),
              )
            }
            className="rounded bg-slate-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Load company products (synthetic-company-1)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("clearCompanyProductDefinitions(synthetic-company-1)", () =>
                getCompanyProductDefinitionsRepository().clearCompanyProductDefinitions("synthetic-company-1"),
              )
            }
            className="rounded bg-slate-300 px-3 py-2 text-xs font-medium text-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          >
            Clear company products (synthetic-company-1)
          </button>
        </div>

        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Phase 2F — local submissions (real saveLocalSubmission/findWorkingLocalSubmissions, synthetic data)
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("saveLocalSubmission(A, project-1, working)", () =>
                getLocalSubmissionRepository().saveLocalSubmission(SYNTHETIC_LOCAL_SUBMISSION_INPUT),
              )
            }
            className="rounded bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Save local submission (A, project-1, working)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("saveLocalSubmission(A, project-1, locally-complete)", () =>
                getLocalSubmissionRepository().saveLocalSubmission({
                  ...SYNTHETIC_LOCAL_SUBMISSION_INPUT,
                  status: "locally-complete",
                }),
              )
            }
            className="rounded bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Mark locally-complete (A, project-1)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("loadLocalSubmission(synthetic-local-submission-1)", () =>
                getLocalSubmissionRepository().loadLocalSubmission("synthetic-local-submission-1"),
              )
            }
            className="rounded bg-slate-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Load local submission (synthetic-local-submission-1)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("findWorkingLocalSubmissions(A, project-1)", () =>
                getLocalSubmissionRepository().findWorkingLocalSubmissions(USER_A, "synthetic-project-1"),
              )
            }
            className="rounded bg-purple-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Find working submissions (A, project-1)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("deleteLocalSubmission(synthetic-local-submission-1)", () =>
                getLocalSubmissionRepository().deleteLocalSubmission("synthetic-local-submission-1"),
              )
            }
            className="rounded bg-slate-300 px-3 py-2 text-xs font-medium text-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          >
            Delete local submission (synthetic-local-submission-1)
          </button>
        </div>

        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Phase 2G — durable local photos (real savePhotoDurably/loadLocalPhotoBlob/deleteLocalPhotoDurably, synthetic data)
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Last saved id: {lastLocalPhotoId ?? "(none yet)"} · Second saved id (different field): {secondLocalPhotoId ?? "(none yet)"}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("savePhotoDurably(A, sub-1, vehicleFront)", async () => {
                const photo = await savePhotoDurably({
                  userId: USER_A,
                  projectId: "synthetic-project-1",
                  localSubmissionId: "synthetic-local-submission-1",
                  fieldName: "vehicleFront",
                  group: "vehicle",
                  bytes: syntheticPhotoBlob(),
                  originalFilename: "synthetic.png",
                  mimeType: "image/png",
                });
                setLastLocalPhotoId(photo.localPhotoId);
                return photo;
              })
            }
            className="rounded bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Save durable photo (A, sub-1, vehicleFront)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("savePhotoDurably(A, sub-1, vehicleSide)", async () => {
                const photo = await savePhotoDurably({
                  userId: USER_A,
                  projectId: "synthetic-project-1",
                  localSubmissionId: "synthetic-local-submission-1",
                  fieldName: "vehicleSide",
                  group: "vehicle",
                  bytes: syntheticPhotoBlob(),
                  originalFilename: "synthetic.png",
                  mimeType: "image/png",
                });
                setSecondLocalPhotoId(photo.localPhotoId);
                return photo;
              })
            }
            className="rounded bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Save second durable photo (A, sub-1, vehicleSide)
          </button>
          <button
            type="button"
            disabled={busy || !lastLocalPhotoId}
            onClick={() =>
              runFieldPackage(`loadLocalPhotoBlob(${lastLocalPhotoId})`, async () => {
                if (!lastLocalPhotoId) return "no id yet";
                const blob = await loadLocalPhotoBlob(lastLocalPhotoId);
                return blob ? { sizeBytes: blob.size, type: blob.type } : null;
              })
            }
            className="rounded bg-slate-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Load last durable photo blob
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("listLocalPhotosForSubmission(synthetic-local-submission-1)", () =>
                getLocalPhotoMetadataRepository().listLocalPhotosForSubmission("synthetic-local-submission-1"),
              )
            }
            className="rounded bg-purple-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            List photos for submission (sub-1)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("listLocalPhotosForField(sub-1, vehicleFront)", () =>
                getLocalPhotoMetadataRepository().listLocalPhotosForField("synthetic-local-submission-1", "vehicleFront"),
              )
            }
            className="rounded bg-purple-500 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            List photos for field (sub-1, vehicleFront)
          </button>
          <button
            type="button"
            disabled={busy || !lastLocalPhotoId}
            onClick={() =>
              runFieldPackage(`deleteLocalPhotoDurably(${lastLocalPhotoId})`, async () => {
                if (!lastLocalPhotoId) return "no id yet";
                await deleteLocalPhotoDurably(lastLocalPhotoId);
                setLastLocalPhotoId(null);
                return "deleted";
              })
            }
            className="rounded bg-slate-300 px-3 py-2 text-xs font-medium text-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          >
            Delete last durable photo (metadata + file)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runFieldPackage("clearLocalPhotosForSubmission(synthetic-local-submission-1)", async () => {
                await getLocalPhotoMetadataRepository().clearLocalPhotosForSubmission("synthetic-local-submission-1");
                setLastLocalPhotoId(null);
                setSecondLocalPhotoId(null);
                return "cleared";
              })
            }
            className="rounded bg-slate-300 px-3 py-2 text-xs font-medium text-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
          >
            Clear all photos for submission (sub-1)
          </button>
        </div>

        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Phase 2G cleanup pass — query ANY real id directly (authorization-removal/logout preservation proofs)
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={queryLocalSubmissionId}
            onChange={(e) => setQueryLocalSubmissionId(e.target.value)}
            placeholder="localSubmissionId"
            className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="button"
            disabled={busy || !queryLocalSubmissionId.trim()}
            onClick={() =>
              runFieldPackage(`listLocalPhotosForSubmission(${queryLocalSubmissionId})`, () =>
                getLocalPhotoMetadataRepository().listLocalPhotosForSubmission(queryLocalSubmissionId.trim()),
              )
            }
            className="rounded bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            List photos for ANY submission id
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={queryLocalPhotoId}
            onChange={(e) => setQueryLocalPhotoId(e.target.value)}
            placeholder="localPhotoId"
            className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="button"
            disabled={busy || !queryLocalPhotoId.trim()}
            onClick={() =>
              runFieldPackage(`loadLocalPhotoMetadata(${queryLocalPhotoId})`, () =>
                getLocalPhotoMetadataRepository().loadLocalPhotoMetadata(queryLocalPhotoId.trim()),
              )
            }
            className="rounded bg-indigo-500 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Load metadata for ANY photo id
          </button>
          <button
            type="button"
            disabled={busy || !queryLocalPhotoId.trim()}
            onClick={() =>
              runFieldPackage(`loadLocalPhotoBlob(${queryLocalPhotoId}) + sha256`, async () => {
                const blob = await loadLocalPhotoBlob(queryLocalPhotoId.trim());
                if (!blob) return { blob: null };
                return { sizeBytes: blob.size, type: blob.type, sha256: await sha256Hex(blob) };
              })
            }
            className="rounded bg-indigo-500 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Load blob + SHA-256 for ANY photo id
          </button>
        </div>
      </div>
    </main>
  );
}
