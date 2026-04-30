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
      setSaveNotice(`Assignment updated. Last updated ${new Date().toLocaleTimeString()}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save assignment";
      setSaveError(msg);
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
          <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">Could not save assignment: {saveError}</section>
        ) : null}
        {saveNotice ? (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">{saveNotice}</section>
        ) : null}

        {!loading && !loadError && canReadPage ? (
          technicians.length === 0 ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">No technicians found for this company.</section>
          ) : projects.length === 0 ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">No projects found for this company.</section>
          ) : (
            <section className="space-y-4">
              {technicians.map((tech) => (
                <article key={tech.userId} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                  <h2 className="text-lg font-bold text-gray-900">{tech.displayName}</h2>
                  <p className="mt-0.5 text-sm text-gray-700">{tech.email}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Assigned projects: {tech.assignedProjectIds.size} / {projects.length}
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {projects.map((project) => {
                      const key = `${tech.userId}::${project.id}`;
                      const isChecked = assignmentSet.has(key);
                      const isSaving = savingKeys.has(key);
                      return (
                        <label
                          key={project.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800"
                        >
                          <span className="min-w-0 truncate">
                            {project.project_name}
                            {!project.active ? <span className="ml-1 text-xs text-amber-700">(inactive)</span> : null}
                          </span>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={!isAdminForCompany || isSaving || !tech.isMembershipActive}
                            onChange={(e) => void handleAssignmentToggle(tech.userId, project.id, e.target.checked)}
                            className="h-4 w-4 accent-blue-600"
                          />
                        </label>
                      );
                    })}
                  </div>
                </article>
              ))}
            </section>
          )
        ) : null}
      </div>
    </main>
  );
}

