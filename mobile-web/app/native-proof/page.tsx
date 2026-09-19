"use client";

import { useEffect, useState } from "react";
import { getActiveProjectsFieldPackage, type FieldPackageProject } from "@/lib/active-projects-field-package";
import { clearLease, issueOrRefreshLease, loadLease } from "@/lib/auth/offline-access-lease";
import { getNetworkStatus } from "@/lib/native/network-status";
import { getProjectWorkPackageRepository } from "@/lib/project-work-package";
import {
  clearProofMarkers,
  readProofMarkers,
  writeProofMarkers,
  type ProofReadResult,
  type ProofWriteResult,
} from "@/lib/native/persistence-proof";

/**
 * Phase 2B field-package proof — clearly synthetic user ids and project
 * data, never written to Supabase/Production. USER_A_SET_2 deliberately
 * drops one project from SET_1 and adds a new one, so "write set 1, then
 * write set 2" exercises the transactional replace path (stale rows from
 * set 1 must not survive alongside set 2's rows).
 */
const USER_A = "phase2b-synthetic-user-a";
const USER_B = "phase2b-synthetic-user-b";

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
      </div>
    </main>
  );
}
