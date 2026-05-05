"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";

type CompanyMembershipRow = {
  user_id: string;
  role: "admin" | "technician";
  is_active: boolean;
};

type UserProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean;
};

type ProjectRow = {
  id: string;
  project_name: string;
  active: boolean;
};

type ProjectAssignmentRow = {
  user_id: string;
  project_id: string;
  is_active: boolean;
};

type TechnicianAssignmentView = {
  userId: string;
  isMembershipActive: boolean;
  displayName: string;
  email: string;
  assignedProjectIds: Set<string>;
};

type CompanyUserView = {
  userId: string;
  displayName: string;
  email: string;
  role: "admin" | "technician";
  isMembershipActive: boolean;
  profileIsActive: boolean;
};

function formatUserLabel(profile: UserProfileRow | null, fallbackUserId: string) {
  const displayName = profile?.display_name?.trim() || "";
  const email = profile?.email?.trim() || "";
  const fallback = fallbackUserId.slice(0, 8);
  return {
    displayName: displayName || email || `User ${fallback}`,
    email: email || "No email",
  };
}

export default function ProjectAssignmentsPage() {
  const params = useParams<{ companyId: string }>();
  const companyId = String(params.companyId || "");
  const { loading: authLoading, context } = useAuthUserContext();

  const [companyName, setCompanyName] = useState("—");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [memberships, setMemberships] = useState<CompanyMembershipRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, UserProfileRow>>({});
  const [assignments, setAssignments] = useState<ProjectAssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [membershipSavingKeys, setMembershipSavingKeys] = useState<Set<string>>(new Set());
  const [assignEmailInput, setAssignEmailInput] = useState("");
  const [inviteDisplayNameInput, setInviteDisplayNameInput] = useState("");
  const [assignRoleInput, setAssignRoleInput] = useState<"admin" | "technician">("technician");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [recentlyChangedKey, setRecentlyChangedKey] = useState<string | null>(null);

  const companyRole = context.companyRolesById[companyId];
  const isGlobalAdmin = context.globalRole === "admin";
  const isAdminForCompany = companyRole === "admin" || isGlobalAdmin;
  const canReadPage = !!context.userId && (isAdminForCompany || companyRole === "technician");

  useEffect(() => {
    let cancelled = false;
    const loadCompanyName = async () => {
      if (!companyId) return;
      try {
        const { data, error } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle<{ name: string }>();
        if (error || cancelled || !data?.name) return;
        setCompanyName(data.name.trim() || "—");
      } catch {
        // keep fallback
      }
    };
    void loadCompanyName();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const loadPageData = useCallback(async () => {
    const [{ data: projectData, error: projectError }, { data: membershipData, error: membershipError }] = await Promise.all([
      supabase.from("projects").select("id, project_name, active").eq("company_id", companyId).order("project_name", { ascending: true }),
      supabase.from("company_memberships").select("user_id, role, is_active").eq("company_id", companyId),
    ]);
    if (projectError) throw projectError;
    if (membershipError) throw membershipError;

    const projectRows = (projectData as ProjectRow[]) || [];
    const membershipRows = (membershipData as CompanyMembershipRow[]) || [];
    const userIds = Array.from(new Set(membershipRows.map((row) => row.user_id).filter(Boolean)));
    const projectIds = projectRows.map((row) => row.id);

    let profileRows: UserProfileRow[] = [];
    if (userIds.length > 0) {
      const { data: profileData, error: profileError } = await supabase
        .from("user_profiles")
        .select("id, email, display_name, is_active")
        .in("id", userIds);
      if (profileError) throw profileError;
      profileRows = (profileData as UserProfileRow[]) || [];
    }

    let assignmentRows: ProjectAssignmentRow[] = [];
    if (projectIds.length > 0 && userIds.length > 0) {
      const { data: assignmentData, error: assignmentError } = await supabase
        .from("project_assignments")
        .select("user_id, project_id, is_active")
        .in("project_id", projectIds)
        .in("user_id", userIds)
        .eq("is_active", true);
      if (assignmentError) throw assignmentError;
      assignmentRows = (assignmentData as ProjectAssignmentRow[]) || [];
    }

    const profileMap = profileRows.reduce<Record<string, UserProfileRow>>((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {});

    setProjects(projectRows);
    setMemberships(membershipRows);
    setProfilesById(profileMap);
    setAssignments(assignmentRows);
    setLoadError(null);
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!companyId) return;
      if (authLoading) return;
      if (!canReadPage) {
        setLoading(false);
        return;
      }

      try {
        await loadPageData();
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load assignments";
          setLoadError(msg);
          setProjects([]);
          setMemberships([]);
          setProfilesById({});
          setAssignments([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, canReadPage, companyId, loadPageData]);

  const assignmentSet = useMemo(() => {
    const keySet = new Set<string>();
    for (const row of assignments) {
      if (!row.is_active) continue;
      keySet.add(`${row.user_id}::${row.project_id}`);
    }
    return keySet;
  }, [assignments]);

  const technicians = useMemo<TechnicianAssignmentView[]>(() => {
    return memberships
      .filter((row) => row.role === "technician" && row.is_active)
      .map((row) => {
        const profile = profilesById[row.user_id] || null;
        const { displayName, email } = formatUserLabel(profile, row.user_id);
        const assignedProjectIds = new Set(
          assignments.filter((a) => a.user_id === row.user_id && a.is_active).map((a) => a.project_id).filter(Boolean),
        );
        return {
          userId: row.user_id,
          isMembershipActive: row.is_active,
          displayName,
          email,
          assignedProjectIds,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [assignments, memberships, profilesById]);

  const companyUsers = useMemo<CompanyUserView[]>(() => {
    return memberships
      .map((row) => {
        const profile = profilesById[row.user_id] || null;
        const { displayName, email } = formatUserLabel(profile, row.user_id);
        return {
          userId: row.user_id,
          displayName,
          email,
          role: row.role,
          isMembershipActive: row.is_active,
          profileIsActive: profile?.is_active ?? true,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [memberships, profilesById]);

  const currentUserAdminMembership = useMemo(
    () => memberships.find((row) => row.user_id === context.userId && row.role === "admin" && row.is_active),
    [context.userId, memberships],
  );
  const isActiveCompanyAdmin = !!currentUserAdminMembership;
  const canManageCompanyUsers = isGlobalAdmin || isActiveCompanyAdmin;
  const canManageAssignments = canManageCompanyUsers;

  const setSavingKey = (key: string, active: boolean) => {
    setSavingKeys((prev) => {
      const next = new Set(prev);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const setMembershipSavingKey = (key: string, active: boolean) => {
    setMembershipSavingKeys((prev) => {
      const next = new Set(prev);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  useEffect(() => {
    if (!recentlyChangedKey) return;
    const timeout = window.setTimeout(() => setRecentlyChangedKey(null), 1400);
    return () => window.clearTimeout(timeout);
  }, [recentlyChangedKey]);

  const handleAssignmentToggle = async (userId: string, projectId: string, shouldAssign: boolean) => {
    const currentUserId = context.userId;
    if (!currentUserId || !canManageAssignments) {
      setSaveError("Only global admins or active company admins can update assignments.");
      setSaveNotice(null);
      return;
    }

    const targetUserMembership = memberships.find(
      (row) => row.user_id === userId && row.role === "technician" && row.is_active,
    );
    if (!targetUserMembership) {
      setSaveError("This user is not an active technician for this company.");
      setSaveNotice(null);
      return;
    }

    const targetProject = projects.find((row) => row.id === projectId);
    if (!targetProject) {
      setSaveError("This project is unavailable for the selected company.");
      setSaveNotice(null);
      return;
    }

    const key = `${userId}::${projectId}`;
    setSavingKey(key, true);
    setSaveError(null);
    setSaveNotice(null);

    try {
      if (shouldAssign) {
        const { error } = await supabase.from("project_assignments").upsert(
          {
            user_id: userId,
            project_id: projectId,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,project_id" },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("project_assignments")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("project_id", projectId);
        if (error) throw error;
      }

      setAssignments((prev) => {
        const existingIndex = prev.findIndex((row) => row.user_id === userId && row.project_id === projectId);
        if (existingIndex === -1 && shouldAssign) {
          return [...prev, { user_id: userId, project_id: projectId, is_active: true }];
        }
        if (existingIndex === -1 && !shouldAssign) return prev;

        const next = [...prev];
        next[existingIndex] = { ...next[existingIndex], is_active: shouldAssign };
        return next;
      });
      const updatedTime = new Date().toLocaleTimeString();
      setSaveError(null);
      setSaveNotice("Assignment updated");
      setLastUpdatedAt(updatedTime);
      setRecentlyChangedKey(key);
    } catch {
      setSaveError("Failed to update assignment");
      setSaveNotice(null);
    } finally {
      setSavingKey(key, false);
    }
  };

  const handleMembershipRoleChange = async (userId: string, role: "admin" | "technician") => {
    if (!context.userId || !canManageCompanyUsers) {
      setSaveError("Only global admins or active company admins can manage company users.");
      setSaveNotice(null);
      return;
    }
    const targetMembership = memberships.find((row) => row.user_id === userId);
    const activeAdminCount = memberships.filter((row) => row.role === "admin" && row.is_active).length;
    const isRemovingLastActiveAdmin =
      !isGlobalAdmin &&
      !!targetMembership &&
      targetMembership.role === "admin" &&
      targetMembership.is_active &&
      role === "technician" &&
      activeAdminCount <= 1;
    if (isRemovingLastActiveAdmin) {
      setSaveError("At least one admin is required for this company");
      setSaveNotice(null);
      return;
    }
    const key = `user-role::${userId}`;
    setMembershipSavingKey(key, true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const { error } = await supabase
        .from("company_memberships")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("user_id", userId);
      if (error) throw error;
      await loadPageData();
      setSaveNotice("User role updated");
      setLastUpdatedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to update user role");
      setSaveNotice(null);
    } finally {
      setMembershipSavingKey(key, false);
    }
  };

  const handleMembershipActiveToggle = async (userId: string, shouldBeActive: boolean) => {
    if (!context.userId || !canManageCompanyUsers) {
      setSaveError("Only global admins or active company admins can manage company users.");
      setSaveNotice(null);
      return;
    }
    const targetMembership = memberships.find((row) => row.user_id === userId);
    const activeAdminCount = memberships.filter((row) => row.role === "admin" && row.is_active).length;
    const isRemovingLastActiveAdmin =
      !isGlobalAdmin &&
      !!targetMembership &&
      targetMembership.role === "admin" &&
      targetMembership.is_active &&
      !shouldBeActive &&
      activeAdminCount <= 1;
    if (isRemovingLastActiveAdmin) {
      setSaveError("At least one admin is required for this company");
      setSaveNotice(null);
      return;
    }
    const key = `user-active::${userId}`;
    setMembershipSavingKey(key, true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const { error } = await supabase
        .from("company_memberships")
        .update({ is_active: shouldBeActive, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("user_id", userId);
      if (error) throw error;
      await loadPageData();
      setSaveNotice(shouldBeActive ? "User reactivated" : "User deactivated");
      setLastUpdatedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to update user status");
      setSaveNotice(null);
    } finally {
      setMembershipSavingKey(key, false);
    }
  };

  const handleInviteOrCreateUser = async () => {
    const email = assignEmailInput.trim().toLowerCase();
    const displayName = inviteDisplayNameInput.trim();
    if (!email) {
      setSaveError("Enter a user email to assign.");
      setSaveNotice(null);
      return;
    }
    if (!context.userId || !canManageCompanyUsers) {
      setSaveError("Only global admins or active company admins can manage company users.");
      setSaveNotice(null);
      return;
    }

    const key = `invite-user::${email}`;
    setMembershipSavingKey(key, true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token?.trim() || "";
      if (!accessToken) {
        setSaveError("You must be signed in to invite or create users.");
        setSaveNotice(null);
        return;
      }
      const res = await fetch("/api/company-users/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          companyId,
          email,
          displayName,
          role: assignRoleInput,
        }),
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        throw new Error(json.error || `Request failed (${res.status})`);
      }

      await loadPageData();
      setAssignEmailInput("");
      setInviteDisplayNameInput("");
      setAssignRoleInput("technician");
      setSaveNotice(json.message || "User invite processed.");
      setLastUpdatedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to invite or create user");
      setSaveNotice(null);
    } finally {
      setMembershipSavingKey(key, false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-5xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <p className="text-center text-lg font-semibold text-gray-700">Company: {companyName}</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Project Assignments</h1>
          <p className="mt-1 text-sm text-gray-600">Assign technicians to the projects they can access.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link
              href={`/companies/${encodeURIComponent(companyId)}/projects`}
              className="inline-flex text-sm font-semibold text-blue-700 hover:underline"
            >
              Back to Projects
            </Link>
            {!authLoading && !isAdminForCompany ? <span className="text-xs font-semibold text-amber-700">Read-only access</span> : null}
          </div>
        </header>

        {!authLoading && !canReadPage ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            You do not have access to this company.
          </section>
        ) : null}

        {loading ? <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">Loading assignments...</section> : null}
        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Could not load data: {loadError}</section>
        ) : null}
        {saveError ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{saveError}</section>
        ) : null}
        {saveNotice ? (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
            {saveNotice}
            {lastUpdatedAt ? <span className="ml-2 text-emerald-700">Last updated: {lastUpdatedAt}</span> : null}
          </section>
        ) : null}

        {!loading && !loadError && canReadPage ? (
          technicians.length === 0 ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">No technicians found for this company.</section>
          ) : projects.length === 0 ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">No projects found for this company.</section>
          ) : (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
              <p className="text-sm font-semibold text-gray-800">Assignment Matrix</p>
              <p className="mt-1 text-xs text-gray-600">
                Rows are technicians. Columns are projects. Check a cell to grant access.
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 min-w-[260px] border border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-800">
                        Technician (row)
                      </th>
                      {projects.map((project) => (
                        <th key={project.id} className="min-w-[140px] border border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-800">
                          <span className="block truncate">{project.project_name}</span>
                          {!project.active ? <span className="text-xs font-medium text-amber-700">(inactive)</span> : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {technicians.map((tech) => (
                      <tr key={tech.userId}>
                        <th className="sticky left-0 z-10 border border-gray-200 bg-white px-3 py-2 text-left align-top">
                          <div className="font-semibold text-gray-900">{tech.displayName}</div>
                          <div className="text-xs text-gray-600">{tech.email}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            Assigned: {tech.assignedProjectIds.size} / {projects.length}
                          </div>
                        </th>
                        {projects.map((project) => {
                          const key = `${tech.userId}::${project.id}`;
                          const isChecked = assignmentSet.has(key);
                          const isSaving = savingKeys.has(key);
                          const wasRecentlyChanged = recentlyChangedKey === key;
                          return (
                            <td
                              key={project.id}
                              className={`border border-gray-200 px-3 py-2 text-center align-middle ${wasRecentlyChanged ? "bg-emerald-50" : "bg-white"}`}
                            >
                              <label className="inline-flex items-center justify-center gap-2 text-xs text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={!canManageAssignments || isSaving || !tech.isMembershipActive}
                                  onChange={(e) => void handleAssignmentToggle(tech.userId, project.id, e.target.checked)}
                                  aria-busy={isSaving}
                                  className="h-4 w-4 accent-blue-600"
                                />
                                {isSaving ? <span className="text-blue-700">Saving...</span> : null}
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        ) : null}

        {!loading && !loadError && canReadPage && canManageCompanyUsers ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            <h2 className="text-lg font-bold tracking-tight text-gray-900">Company Users</h2>
            <p className="mt-1 text-sm text-gray-600">Manage company memberships, roles, and active status.</p>

            <div className="mt-4 grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-[1fr_1fr_180px_auto]">
              <input
                type="email"
                value={assignEmailInput}
                onChange={(e) => setAssignEmailInput(e.target.value)}
                placeholder="user email"
                className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <input
                type="text"
                value={inviteDisplayNameInput}
                onChange={(e) => setInviteDisplayNameInput(e.target.value)}
                placeholder="display name (optional)"
                className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <select
                value={assignRoleInput}
                onChange={(e) => setAssignRoleInput(e.target.value as "admin" | "technician")}
                className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value="technician">technician</option>
                <option value="admin">admin</option>
              </select>
              <button
                type="button"
                onClick={() => void handleInviteOrCreateUser()}
                disabled={membershipSavingKeys.has(`invite-user::${assignEmailInput.trim().toLowerCase()}`)}
                className="min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                Invite / Create User
              </button>
            </div>

            {companyUsers.length === 0 ? (
              <p className="mt-4 text-sm text-gray-600">No company users found yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-800">User</th>
                      <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-800">Role</th>
                      <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-800">Status</th>
                      <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-800">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companyUsers.map((user) => {
                      const roleSavingKey = `user-role::${user.userId}`;
                      const activeSavingKey = `user-active::${user.userId}`;
                      const isSavingRole = membershipSavingKeys.has(roleSavingKey);
                      const isSavingActive = membershipSavingKeys.has(activeSavingKey);
                      return (
                        <tr key={user.userId}>
                          <td className="border border-gray-200 px-3 py-2 align-top">
                            <div className="font-semibold text-gray-900">{user.displayName}</div>
                            <div className="text-xs text-gray-600">{user.email}</div>
                            {!user.profileIsActive ? (
                              <div className="mt-1 text-xs font-medium text-amber-700">Profile inactive</div>
                            ) : null}
                          </td>
                          <td className="border border-gray-200 px-3 py-2 align-top">
                            <select
                              value={user.role}
                              disabled={isSavingRole || isSavingActive}
                              onChange={(e) => void handleMembershipRoleChange(user.userId, e.target.value as "admin" | "technician")}
                              className="min-h-[40px] rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
                            >
                              <option value="admin">admin</option>
                              <option value="technician">technician</option>
                            </select>
                          </td>
                          <td className="border border-gray-200 px-3 py-2 align-top">
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                                user.isMembershipActive ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"
                              }`}
                            >
                              {user.isMembershipActive ? "active" : "inactive"}
                            </span>
                          </td>
                          <td className="border border-gray-200 px-3 py-2 align-top">
                            <button
                              type="button"
                              disabled={isSavingRole || isSavingActive}
                              onClick={() => void handleMembershipActiveToggle(user.userId, !user.isMembershipActive)}
                              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                            >
                              {isSavingActive
                                ? "Saving..."
                                : user.isMembershipActive
                                  ? "Deactivate"
                                  : "Reactivate"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}

