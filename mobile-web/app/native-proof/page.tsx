"use client";

import { useEffect, useState } from "react";
import { getNetworkStatus } from "@/lib/native/network-status";
import {
  clearProofMarkers,
  readProofMarkers,
  writeProofMarkers,
  type ProofReadResult,
  type ProofWriteResult,
} from "@/lib/native/persistence-proof";

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
export default function NativeProofPage() {
  const [writeResult, setWriteResult] = useState<ProofWriteResult | null>(null);
  const [readResult, setReadResult] = useState<ProofReadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveOnline, setLiveOnline] = useState<boolean | null>(null);

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
      </div>
    </main>
  );
}
