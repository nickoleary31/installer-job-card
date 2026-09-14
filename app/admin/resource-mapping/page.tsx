"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";

type SeenOnView = {
  zohoServiceAppointmentId: string;
  zohoServiceAppointmentNumber: string | null;
  projectId: string | null;
  projectName: string | null;
  companyId: string;
  companyName: string | null;
};

type UnmappedResourceView = {
  zohoResourceId: string;
  name: string | null;
  type: string | null;
  zohoUserId: string | null;
  seenOn: SeenOnView[];
};

type MappingView = {
  zohoResourceId: string;
  zohoUserId: string | null;
  zohoResourceName: string | null;
  zohoResourceType: string | null;
  stillObserved: boolean;
  userId: string;
  userDisplayName: string;
  userEmail: string | null;
  mappedBy: string | null;
  mappedByDisplayName: string | null;
  mappedAt: string;
  updatedAt: string;
};

type ActiveUserOption = { userId: string; displayName: string; email: string };

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function ResourceMappingAdminPage() {
  const router = useRouter();
  const { loading: authLoading, context } = useAuthUserContext();
  const isGlobalAdmin = context.globalRole === "admin" && context.profileIsActive;

  const [unmapped, setUnmapped] = useState<UnmappedResourceView[]>([]);
  const [mappings, setMappings] = useState<MappingView[]>([]);
  const [users, setUsers] = useState<ActiveUserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedUserByResource, setSelectedUserByResource] = useState<Record<string, string>>({});

  const getAccessToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token?.trim() || "";
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("You must be signed in.");
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [unmappedRes, mappingsRes, usersRes] = await Promise.all([
        fetch("/api/admin/resource-mapping/unmapped", { headers }),
        fetch("/api/admin/resource-mapping/mappings", { headers }),
        fetch("/api/admin/users/list", { headers }),
      ]);
      const unmappedJson = (await unmappedRes.json()) as { error?: string; resources?: UnmappedResourceView[] };
      const mappingsJson = (await mappingsRes.json()) as { error?: string; mappings?: MappingView[] };
      const usersJson = (await usersRes.json()) as {
        error?: string;
        users?: Array<{ userId: string; displayName: string; authEmail: string; profileEmail: string; isActive: boolean }>;
      };
      if (!unmappedRes.ok) throw new Error(unmappedJson.error || `Failed to load unmapped resources (${unmappedRes.status})`);
      if (!mappingsRes.ok) throw new Error(mappingsJson.error || `Failed to load mappings (${mappingsRes.status})`);
      if (!usersRes.ok) throw new Error(usersJson.error || `Failed to load users (${usersRes.status})`);

      setUnmapped(unmappedJson.resources || []);
      setMappings(mappingsJson.mappings || []);
      setUsers(
        (usersJson.users || [])
          .filter((u) => u.isActive)
          .map((u) => ({ userId: u.userId, displayName: u.displayName, email: u.authEmail || u.profileEmail || "" }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      );
    } catch (e) {
      setUnmapped([]);
      setMappings([]);
      setUsers([]);
      setLoadError(e instanceof Error ? e.message : "Failed to load resource mapping data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!context.userId) {
      router.replace("/login");
      return;
    }
    if (!isGlobalAdmin) return;
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, context.userId, isGlobalAdmin, loadData, router]);

  const handleSaveMapping = async (zohoResourceId: string) => {
    const userId = selectedUserByResource[zohoResourceId];
    if (!userId) {
      setError("Select a user before saving.");
      return;
    }
    setBusyKey(`save::${zohoResourceId}`);
    setError(null);
    setNotice(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("You must be signed in.");
      const res = await fetch("/api/admin/resource-mapping/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ zohoResourceId, userId }),
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setNotice(json.message || "Mapping saved.");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save mapping");
    } finally {
      setBusyKey(null);
    }
  };

  const mappedCount = useMemo(() => mappings.length, [mappings]);

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-gray-600">Checking sign-in…</p>
      </main>
    );
  }

  if (!context.userId) return null;

  if (!isGlobalAdmin) {
    return (
      <main className="min-h-screen bg-slate-50 py-6">
        <div className="mx-auto max-w-3xl px-4">
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Only active global admins can access Zoho Resource Mapping.
          </section>
          <Link href="/home" className="mt-4 inline-flex text-sm font-semibold text-blue-700 hover:underline">
            Back to Home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-6xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Zoho Resource Mapping</h1>
          <p className="mt-1 text-sm text-gray-600">
            Map each Zoho Service Resource to a permanent Installer Sheetz user. Identity only — this does
            not assign anyone to a project yet.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href="/home" className="text-sm font-semibold text-blue-700 hover:underline">
              Home
            </Link>
            <Link href="/admin/users" className="text-sm font-semibold text-blue-700 hover:underline">
              Global Users
            </Link>
          </div>
        </header>

        {error ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</section>
        ) : null}
        {notice ? (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</section>
        ) : null}
        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{loadError}</section>
        ) : null}

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-gray-900">Unmapped Zoho Resources ({unmapped.length})</h2>
          <p className="mt-1 text-xs text-gray-600">
            Resources seen on a stored Zoho Service Appointment that have no confirmed Installer Sheetz user yet.
          </p>

          {loading ? <p className="mt-4 text-sm text-gray-600">Loading…</p> : null}
          {!loading && unmapped.length === 0 ? (
            <p className="mt-4 text-sm text-gray-600">No unmapped resources — everything observed so far is mapped.</p>
          ) : null}

          <div className="mt-4 space-y-3">
            {unmapped.map((resource) => {
              const busy = busyKey === `save::${resource.zohoResourceId}`;
              return (
                <article key={resource.zohoResourceId} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-bold text-gray-950">{resource.name || "(unnamed resource)"}</h3>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-800">
                          Zoho id: {resource.zohoResourceId}
                        </span>
                        {resource.type ? (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-800">
                            type: {resource.type}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-xs text-gray-600">
                        Seen on:{" "}
                        {resource.seenOn.map((s, i) => (
                          <span key={s.zohoServiceAppointmentId}>
                            {i > 0 ? ", " : ""}
                            {s.zohoServiceAppointmentNumber || s.zohoServiceAppointmentId}
                            {s.projectName ? ` (${s.projectName}${s.companyName ? `, ${s.companyName}` : ""})` : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={selectedUserByResource[resource.zohoResourceId] || ""}
                        onChange={(e) =>
                          setSelectedUserByResource((prev) => ({ ...prev, [resource.zohoResourceId]: e.target.value }))
                        }
                        className="min-h-[40px] min-w-[220px] rounded-lg border border-gray-300 px-3 text-sm"
                      >
                        <option value="">Select Installer Sheetz user…</option>
                        {users.map((u) => (
                          <option key={u.userId} value={u.userId}>
                            {u.displayName} ({u.email || u.userId.slice(0, 8)})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy || !selectedUserByResource[resource.zohoResourceId]}
                        onClick={() => void handleSaveMapping(resource.zohoResourceId)}
                        className="min-h-[40px] rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        {busy ? "Saving…" : "Save Mapping"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-gray-900">Existing Mappings ({mappedCount})</h2>
          {!loading && mappings.length === 0 ? <p className="mt-4 text-sm text-gray-600">No mappings yet.</p> : null}
          <div className="mt-4 space-y-2">
            {mappings.map((m) => (
              <div
                key={m.zohoResourceId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-semibold text-gray-900">
                    {m.zohoResourceName || m.zohoResourceId}{" "}
                    <span className="font-normal text-gray-600">→ {m.userDisplayName}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    Zoho id {m.zohoResourceId} · mapped by {m.mappedByDisplayName || "—"} on {formatDate(m.mappedAt)}
                    {!m.stillObserved ? " · not seen on any recent SA" : ""}
                  </div>
                </div>
                {!m.stillObserved ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    stale
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
