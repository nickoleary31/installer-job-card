"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [recentlyChangedKey, setRecentlyChangedKey] = useState<string | null>(null);

  const companyRole = context.companyRolesById[companyId];
  const isAdminForCompany = companyRole === "admin";
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
        const [{ data: projectData, error: projectError }, { data: membershipData, error: membershipError }] = await Promise.all([
          supabase.from("projects").select("id, project_name, active").eq("company_id", companyId).order("project_name", { ascending: true }),
          supabase.from("company_memberships").select("user_id, role, is_active").eq("company_id", companyId).eq("is_active", true),
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

        if (cancelled) return;

        const profileMap = profileRows.reduce<Record<string, UserProfileRow>>((acc, row) => {
          acc[row.id] = row;
          return acc;
        }, {});

        setProjects(projectRows);
        setMemberships(membershipRows);
        setProfilesById(profileMap);
        setAssignments(assignmentRows);
        setLoadError(null);
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
  }, [authLoading, canReadPage, companyId]);

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
      .filter((row) => row.role === "technician")
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

  const setSavingKey = (key: string, active: boolean) => {
    setSavingKeys((prev) => {
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
    const currentUserAdminMembership = memberships.find(
      (row) => row.user_id === currentUserId && row.role === "admin" && row.is_active,
    );
    if (!currentUserId || !isAdminForCompany || !currentUserAdminMembership) {
      setSaveError("Only active company admins can update assignments.");
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
                                  disabled={!isAdminForCompany || isSaving || !tech.isMembershipActive}
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
      </div>
    </main>
  );
}

