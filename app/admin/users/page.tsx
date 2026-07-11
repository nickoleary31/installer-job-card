"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";

type CompanyOption = { id: string; name: string };

type MembershipView = {
  companyId: string;
  companyName: string;
  role: "admin" | "technician";
  isActive: boolean;
  createdAt: string | null;
};

type AdminUserView = {
  userId: string;
  email: string;
  displayName: string;
  globalRole: "admin" | "technician";
  isActive: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  companyMemberships: MembershipView[];
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { loading: authLoading, context } = useAuthUserContext();
  const isGlobalAdmin = context.globalRole === "admin" && context.profileIsActive;

  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const [changeEmailUserId, setChangeEmailUserId] = useState<string | null>(null);
  const [changeEmailValue, setChangeEmailValue] = useState("");
  const [editNameUserId, setEditNameUserId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [inviteCompanyId, setInviteCompanyId] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "technician">("technician");

  const [addUserId, setAddUserId] = useState("");
  const [addCompanyId, setAddCompanyId] = useState("");
  const [addRole, setAddRole] = useState<"admin" | "technician">("technician");

  const getAccessToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token?.trim() || "";
  };

  const loadData = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setLoadError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("You must be signed in.");
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [usersRes, companiesRes] = await Promise.all([
        fetch("/api/admin/users/list", { headers }),
        fetch("/api/admin/companies", { headers }),
      ]);
      const usersJson = (await usersRes.json()) as { error?: string; users?: AdminUserView[] };
      const companiesJson = (await companiesRes.json()) as { error?: string; companies?: CompanyOption[] };
      if (!usersRes.ok) throw new Error(usersJson.error || `Failed to load users (${usersRes.status})`);
      if (!companiesRes.ok) throw new Error(companiesJson.error || `Failed to load companies (${companiesRes.status})`);
      const nextCompanies = companiesJson.companies || [];
      setUsers(usersJson.users || []);
      setCompanies(nextCompanies);
      setInviteCompanyId((prev) => prev || nextCompanies[0]?.id || "");
      setAddCompanyId((prev) => prev || nextCompanies[0]?.id || "");
    } catch (e) {
      setUsers([]);
      setCompanies([]);
      setLoadError(e instanceof Error ? e.message : "Failed to load admin users");
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

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = [
        u.displayName,
        u.email,
        u.userId,
        u.globalRole,
        ...u.companyMemberships.map((m) => `${m.companyName} ${m.role}`),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [filter, users]);

  const runAction = async (key: string, fn: () => Promise<string>) => {
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      const message = await fn();
      setNotice(message);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyKey(null);
    }
  };

  const handleChangeEmail = async () => {
    if (!changeEmailUserId) return;
    await runAction(`email::${changeEmailUserId}`, async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("You must be signed in.");
      const res = await fetch("/api/company-users/change-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId: changeEmailUserId, newEmail: changeEmailValue.trim().toLowerCase() }),
      });
      const json = (await res.json()) as { error?: string; message?: string; selfUpdate?: boolean };
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setChangeEmailUserId(null);
      setChangeEmailValue("");
      return (
        json.message ||
        (json.selfUpdate
          ? "Your login email was updated. Sign out and sign back in using the new email before continuing."
          : "Login email updated.")
      );
    });
  };

  const handleSaveDisplayName = async () => {
    if (!editNameUserId) return;
    await runAction(`name::${editNameUserId}`, async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("You must be signed in.");
      const res = await fetch("/api/admin/users/update-display-name", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId: editNameUserId, displayName: editNameValue.trim() }),
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setEditNameUserId(null);
      setEditNameValue("");
      return json.message || "Display name updated.";
    });
  };

  const handleInvite = async () => {
    await runAction("invite", async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("You must be signed in.");
      if (!inviteCompanyId) throw new Error("Select a company for the invite.");
      const res = await fetch("/api/company-users/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          companyId: inviteCompanyId,
          email: inviteEmail.trim().toLowerCase(),
          displayName: inviteDisplayName.trim(),
          role: inviteRole,
        }),
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setInviteEmail("");
      setInviteDisplayName("");
      return json.message || "Invite processed.";
    });
  };

  const handleAddExisting = async () => {
    await runAction("add-existing", async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("You must be signed in.");
      if (!addUserId) throw new Error("Select a user.");
      if (!addCompanyId) throw new Error("Select a company.");
      const res = await fetch("/api/company-users/add-existing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          companyId: addCompanyId,
          userId: addUserId,
          role: addRole,
        }),
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      return json.message || "User added to company.";
    });
  };

  const handleSetMembershipActive = async (userId: string, companyId: string, isActive: boolean) => {
    await runAction(`membership::${userId}::${companyId}`, async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("You must be signed in.");
      const res = await fetch("/api/admin/users/set-membership-active", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId, companyId, isActive }),
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      return json.message || "Membership updated.";
    });
  };

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
            Only active global admins can access Global Users.
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
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Global Users</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage all app users, login emails, and company memberships. Global admin only.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href="/home" className="text-sm font-semibold text-blue-700 hover:underline">
              Home
            </Link>
            <Link href="/companies" className="text-sm font-semibold text-blue-700 hover:underline">
              Companies
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

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-gray-900">Invite New User</h2>
            <p className="mt-1 text-xs text-gray-600">Reuses the secure invite API. Does not create duplicates for existing emails.</p>
            <div className="mt-3 grid gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email"
                className="min-h-[40px] rounded-lg border border-gray-300 px-3 text-sm"
              />
              <input
                type="text"
                value={inviteDisplayName}
                onChange={(e) => setInviteDisplayName(e.target.value)}
                placeholder="display name (optional)"
                className="min-h-[40px] rounded-lg border border-gray-300 px-3 text-sm"
              />
              <select
                value={inviteCompanyId}
                onChange={(e) => setInviteCompanyId(e.target.value)}
                className="min-h-[40px] rounded-lg border border-gray-300 px-3 text-sm"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "admin" | "technician")}
                className="min-h-[40px] rounded-lg border border-gray-300 px-3 text-sm"
              >
                <option value="technician">technician</option>
                <option value="admin">admin</option>
              </select>
              <button
                type="button"
                disabled={busyKey === "invite"}
                onClick={() => void handleInvite()}
                className="min-h-[40px] rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {busyKey === "invite" ? "Inviting…" : "Invite New User"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-gray-900">Add Existing User to Company</h2>
            <p className="mt-1 text-xs text-gray-600">Reuses membership upsert/reactivate logic. Does not create Auth users.</p>
            <div className="mt-3 grid gap-2">
              <select
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
                className="min-h-[40px] rounded-lg border border-gray-300 px-3 text-sm"
              >
                <option value="">Select user</option>
                {users.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.displayName} ({u.email || u.userId.slice(0, 8)})
                  </option>
                ))}
              </select>
              <select
                value={addCompanyId}
                onChange={(e) => setAddCompanyId(e.target.value)}
                className="min-h-[40px] rounded-lg border border-gray-300 px-3 text-sm"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as "admin" | "technician")}
                className="min-h-[40px] rounded-lg border border-gray-300 px-3 text-sm"
              >
                <option value="technician">technician</option>
                <option value="admin">admin</option>
              </select>
              <button
                type="button"
                disabled={busyKey === "add-existing"}
                onClick={() => void handleAddExisting()}
                className="min-h-[40px] rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busyKey === "add-existing" ? "Adding…" : "Add Existing User to Company"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-gray-900">All Users ({filteredUsers.length})</h2>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, email, UUID, company…"
              className="min-h-[40px] min-w-[240px] flex-1 rounded-lg border border-gray-300 px-3 text-sm sm:max-w-md"
            />
          </div>

          {loading ? <p className="mt-4 text-sm text-gray-600">Loading users…</p> : null}

          {!loading && filteredUsers.length === 0 ? (
            <p className="mt-4 text-sm text-gray-600">No users found.</p>
          ) : null}

          <div className="mt-4 space-y-3">
            {filteredUsers.map((user) => {
              const expanded = expandedUserId === user.userId;
              const editingEmail = changeEmailUserId === user.userId;
              const editingName = editNameUserId === user.userId;
              return (
                <article key={user.userId} className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-gray-950">{user.displayName}</h3>
                      <p className="text-sm text-gray-700">{user.email || "No email"}</p>
                      <p className="mt-1 font-mono text-xs text-gray-500">{user.userId}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-800">
                          global: {user.globalRole}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-semibold ${
                            user.isActive ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"
                          }`}
                        >
                          {user.isActive ? "profile active" : "profile inactive"}
                        </span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-gray-700 ring-1 ring-gray-200">
                          created {formatDate(user.createdAt)}
                        </span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-gray-700 ring-1 ring-gray-200">
                          last sign-in {formatDate(user.lastSignInAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50"
                        onClick={() => {
                          setExpandedUserId(expanded ? null : user.userId);
                        }}
                      >
                        {expanded ? "Hide Memberships" : "View Company Memberships"}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50"
                        onClick={() => {
                          setChangeEmailUserId(user.userId);
                          setChangeEmailValue(user.email);
                          setEditNameUserId(null);
                        }}
                      >
                        Change Login Email
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-50"
                        onClick={() => {
                          setEditNameUserId(user.userId);
                          setEditNameValue(user.displayName);
                          setChangeEmailUserId(null);
                        }}
                      >
                        Edit Display Name
                      </button>
                    </div>
                  </div>

                  {editingEmail ? (
                    <div className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <input
                        type="email"
                        value={changeEmailValue}
                        onChange={(e) => setChangeEmailValue(e.target.value)}
                        className="min-h-[40px] w-full rounded-md border border-blue-300 bg-white px-3 text-sm"
                      />
                      <p className="text-[11px] text-blue-900/80">
                        Updates Auth + profile email. UUID and global role stay the same.
                        {changeEmailUserId === context.userId
                          ? " After saving, sign out and sign back in with the new email."
                          : " The user must sign out and log in with the new email."}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busyKey === `email::${user.userId}`}
                          onClick={() => void handleChangeEmail()}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          Save Login Email
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setChangeEmailUserId(null);
                            setChangeEmailValue("");
                          }}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {editingName ? (
                    <div className="mt-3 space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
                      <input
                        type="text"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        className="min-h-[40px] w-full rounded-md border border-violet-300 bg-white px-3 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busyKey === `name::${user.userId}`}
                          onClick={() => void handleSaveDisplayName()}
                          className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          Save Display Name
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditNameUserId(null);
                            setEditNameValue("");
                          }}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {expanded ? (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
                      <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500">Company memberships</h4>
                      {user.companyMemberships.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-600">No company memberships.</p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {user.companyMemberships.map((m) => (
                            <li
                              key={`${user.userId}-${m.companyId}`}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 px-3 py-2 text-sm"
                            >
                              <div>
                                <div className="font-semibold text-gray-900">
                                  {m.companyName}{" "}
                                  <span className="font-normal text-gray-600">({m.role})</span>
                                </div>
                                <div className="text-xs text-gray-500">
                                  {m.isActive ? "active" : "inactive"} · since {formatDate(m.createdAt)}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Link
                                  href={`/companies/${encodeURIComponent(m.companyId)}/assignments`}
                                  className="rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-50"
                                >
                                  Open assignments
                                </Link>
                                <button
                                  type="button"
                                  disabled={busyKey === `membership::${user.userId}::${m.companyId}`}
                                  onClick={() => void handleSetMembershipActive(user.userId, m.companyId, !m.isActive)}
                                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                                >
                                  {m.isActive ? "Deactivate membership" : "Reactivate membership"}
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
