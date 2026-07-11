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

type UserSearchResult = {
  userId: string;
  email: string;
  displayName: string;
  profileIsActive: boolean;
  companyMemberships: Array<{
    companyId: string;
    companyName: string;
    role: string;
    isActive: boolean;
  }>;
  targetCompanyMembership: { role: string; isActive: boolean } | null;
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
  const [existingUserRoleInput, setExistingUserRoleInput] = useState<"admin" | "technician">("technician");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<UserSearchResult[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [selectedExistingUserId, setSelectedExistingUserId] = useState<string | null>(null);
  const [changeEmailUserId, setChangeEmailUserId] = useState<string | null>(null);
  const [changeEmailValue, setChangeEmailValue] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [recentlyChangedKey, setRecentlyChangedKey] = useState<string | null>(null);

  const companyRole = context.companyRolesById[companyId];
  const isGlobalAdmin = context.globalRole === "admin" && context.profileIsActive;
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
      setSaveError("Enter a user email to invite.");
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
        setSaveError("You must be signed in to invite users.");
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
      setSaveError(e instanceof Error ? e.message : "Failed to invite user");
      setSaveNotice(null);
    } finally {
      setMembershipSavingKey(key, false);
    }
  };

  const getAccessToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token?.trim() || "";
  };

  const runUserSearch = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (query.length < 2 || !canManageCompanyUsers) return;

    setUserSearchLoading(true);
    setUserSearchError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setUserSearchError("You must be signed in to search users.");
        setUserSearchResults([]);
        return;
      }
      const res = await fetch("/api/company-users/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ companyId, query }),
      });
      const json = (await res.json()) as { error?: string; results?: UserSearchResult[] };
      if (!res.ok) {
        throw new Error(json.error || `Search failed (${res.status})`);
      }
      setUserSearchResults(json.results || []);
      setSelectedExistingUserId(null);
    } catch (e) {
      setUserSearchResults([]);
      setUserSearchError(e instanceof Error ? e.message : "Failed to search users");
    } finally {
      setUserSearchLoading(false);
    }
  };

  useEffect(() => {
    if (!canManageCompanyUsers) return;
    const query = userSearchQuery.trim();
    if (query.length < 2) return;
    const timer = window.setTimeout(() => {
      void runUserSearch(query);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on query/company only
  }, [userSearchQuery, companyId, canManageCompanyUsers]);

  const handleUserSearchQueryChange = (value: string) => {
    setUserSearchQuery(value);
    if (value.trim().length < 2) {
      setUserSearchResults([]);
      setUserSearchError(null);
      setSelectedExistingUserId(null);
      setUserSearchLoading(false);
    }
  };
  const handleAddExistingUser = async () => {
    if (!selectedExistingUserId) {
      setSaveError("Select an existing user from the search results.");
      setSaveNotice(null);
      return;
    }
    if (!context.userId || !canManageCompanyUsers) {
      setSaveError("Only global admins or active company admins can manage company users.");
      setSaveNotice(null);
      return;
    }

    const key = `add-existing::${selectedExistingUserId}`;
    setMembershipSavingKey(key, true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setSaveError("You must be signed in to add users.");
        setSaveNotice(null);
        return;
      }
      const res = await fetch("/api/company-users/add-existing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          companyId,
          userId: selectedExistingUserId,
          role: existingUserRoleInput,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        message?: string;
        alreadyActive?: boolean;
        displayName?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || `Request failed (${res.status})`);
      }

      await loadPageData();
      setSaveNotice(json.message || "Existing user added to company.");
      setLastUpdatedAt(new Date().toLocaleTimeString());
      if (!json.alreadyActive) {
        setUserSearchQuery("");
        setUserSearchResults([]);
        setSelectedExistingUserId(null);
        setExistingUserRoleInput("technician");
      } else {
        void runUserSearch(userSearchQuery);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to add existing user");
      setSaveNotice(null);
    } finally {
      setMembershipSavingKey(key, false);
    }
  };

  const openChangeEmail = (userId: string, currentEmail: string) => {
    setChangeEmailUserId(userId);
    setChangeEmailValue(currentEmail === "No email" ? "" : currentEmail);
    setSaveError(null);
    setSaveNotice(null);
  };

  const cancelChangeEmail = () => {
    setChangeEmailUserId(null);
    setChangeEmailValue("");
  };

  const handleChangeLoginEmail = async () => {
    if (!isGlobalAdmin) {
      setSaveError("Only global admins can change login emails.");
      setSaveNotice(null);
      return;
    }
    if (!changeEmailUserId) {
      setSaveError("Select a user to update.");
      setSaveNotice(null);
      return;
    }
    const newEmail = changeEmailValue.trim().toLowerCase();
    if (!newEmail || !newEmail.includes("@")) {
      setSaveError("Enter a valid new login email.");
      setSaveNotice(null);
      return;
    }

    const key = `change-email::${changeEmailUserId}`;
    setMembershipSavingKey(key, true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setSaveError("You must be signed in to change login emails.");
        setSaveNotice(null);
        return;
      }
      const res = await fetch("/api/company-users/change-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId: changeEmailUserId,
          newEmail,
        }),
      });
      const json = (await res.json()) as { error?: string; message?: string; selfUpdate?: boolean };
      if (!res.ok) {
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      await loadPageData();
      setSaveNotice(
        json.message ||
          (json.selfUpdate
            ? "Your login email was updated. Sign out and sign back in using the new email before continuing."
            : "Login email updated. The user must sign out and log back in with the new email."),
      );
      setLastUpdatedAt(new Date().toLocaleTimeString());
      cancelChangeEmail();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to change login email");
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
            <p className="mt-1 text-sm text-gray-600">
              Add an existing technician from another company, or invite a brand-new user by email.
            </p>

            <div className="mt-5 space-y-6">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-sm font-bold text-gray-900">1. Add Existing User</h3>
                <p className="mt-1 text-xs text-gray-600">
                  Search all app users by name, email, or user ID. Does not create a new Auth account.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
                  <input
                    type="search"
                    value={userSearchQuery}
                    onChange={(e) => handleUserSearchQueryChange(e.target.value)}
                    placeholder="Search name, email, or UUID"
                    className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  />
                  <select
                    value={existingUserRoleInput}
                    onChange={(e) => setExistingUserRoleInput(e.target.value as "admin" | "technician")}
                    className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  >
                    <option value="technician">technician</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
                {userSearchLoading ? <p className="mt-2 text-xs text-gray-600">Searching…</p> : null}
                {userSearchError ? <p className="mt-2 text-xs font-medium text-red-700">{userSearchError}</p> : null}
                {!userSearchLoading && userSearchQuery.trim().length >= 2 && userSearchResults.length === 0 && !userSearchError ? (
                  <p className="mt-2 text-xs text-gray-600">No matching users found.</p>
                ) : null}
                {userSearchResults.length > 0 ? (
                  <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {userSearchResults.map((result) => {
                      const selected = selectedExistingUserId === result.userId;
                      const membershipSummary =
                        result.companyMemberships.length > 0
                          ? result.companyMemberships
                              .map(
                                (m) =>
                                  `${m.companyName} (${m.role}${m.isActive ? "" : ", inactive"})`,
                              )
                              .join(" · ")
                          : "No company memberships";
                      const alreadyActiveHere = !!result.targetCompanyMembership?.isActive;
                      return (
                        <li key={result.userId}>
                          <button
                            type="button"
                            onClick={() => setSelectedExistingUserId(result.userId)}
                            className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                              selected
                                ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                                : "border-gray-200 bg-white hover:border-gray-300"
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="font-semibold text-gray-900">{result.displayName}</div>
                                <div className="text-xs text-gray-600">{result.email || "No email"}</div>
                                <div className="mt-1 text-xs text-gray-500">{membershipSummary}</div>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                    result.profileIsActive
                                      ? "bg-emerald-100 text-emerald-800"
                                      : "bg-gray-200 text-gray-700"
                                  }`}
                                >
                                  {result.profileIsActive ? "profile active" : "profile inactive"}
                                </span>
                                {alreadyActiveHere ? (
                                  <span className="text-[11px] font-semibold text-amber-700">Already on this company</span>
                                ) : result.targetCompanyMembership ? (
                                  <span className="text-[11px] font-semibold text-blue-700">Inactive on this company</span>
                                ) : null}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleAddExistingUser()}
                  disabled={
                    !selectedExistingUserId ||
                    membershipSavingKeys.has(`add-existing::${selectedExistingUserId || ""}`)
                  }
                  className="mt-3 min-h-[44px] rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {selectedExistingUserId && membershipSavingKeys.has(`add-existing::${selectedExistingUserId}`)
                    ? "Adding…"
                    : "Add Existing User to Company"}
                </button>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-sm font-bold text-gray-900">2. Invite New User</h3>
                <p className="mt-1 text-xs text-gray-600">
                  Creates a new Auth invite for an email that is not already in the app. Requires{" "}
                  <code className="rounded bg-white px-1">SUPABASE_SERVICE_ROLE_KEY</code> on the server.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_180px_auto]">
                  <input
                    type="email"
                    value={assignEmailInput}
                    onChange={(e) => setAssignEmailInput(e.target.value)}
                    placeholder="new user email"
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
                    Invite New User
                  </button>
                </div>
              </div>
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
                      const changeEmailKey = `change-email::${user.userId}`;
                      const isSavingRole = membershipSavingKeys.has(roleSavingKey);
                      const isSavingActive = membershipSavingKeys.has(activeSavingKey);
                      const isSavingEmail = membershipSavingKeys.has(changeEmailKey);
                      const isEditingEmail = changeEmailUserId === user.userId;
                      return (
                        <tr key={user.userId}>
                          <td className="border border-gray-200 px-3 py-2 align-top">
                            <div className="font-semibold text-gray-900">{user.displayName}</div>
                            <div className="text-xs text-gray-600">{user.email}</div>
                            {!user.profileIsActive ? (
                              <div className="mt-1 text-xs font-medium text-amber-700">Profile inactive</div>
                            ) : null}
                            {isEditingEmail ? (
                              <div className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                                <label className="block text-xs font-semibold text-blue-900">
                                  New login email
                                </label>
                                <input
                                  type="email"
                                  value={changeEmailValue}
                                  onChange={(e) => setChangeEmailValue(e.target.value)}
                                  placeholder="new@email.com"
                                  className="min-h-[40px] w-full rounded-md border border-blue-300 bg-white px-2 py-1 text-sm text-gray-900"
                                  disabled={isSavingEmail}
                                />
                                <p className="text-[11px] leading-snug text-blue-900/80">
                                  Keeps the same user ID and global role.
                                  {changeEmailUserId === context.userId
                                    ? " After saving, sign out and sign back in with the new email."
                                    : " The user must sign out and log back in with the new email."}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={isSavingEmail}
                                    onClick={() => void handleChangeLoginEmail()}
                                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                                  >
                                    {isSavingEmail ? "Saving…" : "Save Login Email"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isSavingEmail}
                                    onClick={cancelChangeEmail}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </td>
                          <td className="border border-gray-200 px-3 py-2 align-top">
                            <select
                              value={user.role}
                              disabled={isSavingRole || isSavingActive || isSavingEmail}
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
                            <div className="flex flex-col gap-2">
                              <button
                                type="button"
                                disabled={isSavingRole || isSavingActive || isSavingEmail}
                                onClick={() => void handleMembershipActiveToggle(user.userId, !user.isMembershipActive)}
                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                              >
                                {isSavingActive
                                  ? "Saving..."
                                  : user.isMembershipActive
                                    ? "Deactivate"
                                    : "Reactivate"}
                              </button>
                              {isGlobalAdmin ? (
                                <button
                                  type="button"
                                  disabled={isSavingRole || isSavingActive || isSavingEmail || isEditingEmail}
                                  onClick={() => openChangeEmail(user.userId, user.email)}
                                  className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-60"
                                >
                                  Change Login Email
                                </button>
                              ) : null}
                            </div>
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

