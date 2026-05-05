"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import {
  type StarterDataSnapshot,
  getBestStarterSnapshotForOffline,
  upsertStarterDataSnapshot,
} from "@/lib/starter-data-cache";
import { supabase } from "@/lib/supabase/client";

const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";

type ProjectCardRow = {
  id: string;
  project_name: string;
  active: boolean;
  displayCustomerName: string;
  completedSubmissionCount: number;
};

type ProjectQueryRow = {
  id: string;
  project_name: string;
  active: boolean;
  customer_id: string | null;
  customer_name: string | null;
  customers: { customer_name: string | null } | { customer_name: string | null }[] | null;
};

type CompanyRow = {
  name: string;
};

type CustomerOption = {
  id: string;
  customer_name: string | null;
  full_address: string | null;
};

type NewCustomerForm = {
  customer_name: string;
  full_address: string;
  site_contact_name: string;
  contact_number: string;
  license_key_1: string;
  license_key_2: string;
  server_port_type: "" | "TLS" | "Proprietary";
  server_port_number: string;
  facility_code: string;
  wifi_ssid: string;
  wifi_password: string;
  notes: string;
};

const emptyNewCustomerForm = (): NewCustomerForm => ({
  customer_name: "",
  full_address: "",
  site_contact_name: "",
  contact_number: "",
  license_key_1: "",
  license_key_2: "",
  server_port_type: "",
  server_port_number: "",
  facility_code: "",
  wifi_ssid: "",
  wifi_password: "",
  notes: "",
});

export default function CompanyProjectsPage() {
  const params = useParams<{ companyId: string }>();
  const router = useRouter();
  const { loading: authLoading, context: userContext } = useAuthUserContext();
  const companyId = String(params.companyId || "");
  const [projects, setProjects] = useState<ProjectCardRow[]>([]);
  const [companyName, setCompanyName] = useState("—");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState("");
  const [customerNameInput, setCustomerNameInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [externalEmailsInput, setExternalEmailsInput] = useState("");
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerSiteInput, setCustomerSiteInput] = useState("");
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [customerLoadError, setCustomerLoadError] = useState<string | null>(null);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState<NewCustomerForm>(emptyNewCustomerForm);
  const [newCustomerError, setNewCustomerError] = useState<string | null>(null);
  const [isSavingNewCustomer, setIsSavingNewCustomer] = useState(false);
  const [assignedProjectIds, setAssignedProjectIds] = useState<string[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [isOffline, setIsOffline] = useState(() => (typeof window !== "undefined" ? !window.navigator.onLine : false));
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [offlineSnapshot, setOfflineSnapshot] = useState<StarterDataSnapshot | null>(null);
  const [offlineProjectsCacheMiss, setOfflineProjectsCacheMiss] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setIsOffline(!window.navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (!companyId) return;
    try {
      window.localStorage.setItem(SELECTED_COMPANY_ID_KEY, companyId);
    } catch {
      // ignore storage errors
    }
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    const loadCompanyName = async () => {
      if (!companyId) return;
      if (typeof window !== "undefined" && !window.navigator.onLine) return;
      if (authLoading) return;
      if (!userContext.userId) {
        if (!cancelled) setCompanyName("—");
        return;
      }
      try {
        const { data, error } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle<CompanyRow>();
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
  }, [authLoading, companyId, userContext.userId]);

  const loadProjects = useCallback(async () => {
    if (!companyId) return;
    const { data: projData, error: projError } = await supabase
      .from("projects")
      .select(
        "id, project_name, active, customer_id, customer_name, customers:customer_id(customer_name)",
      )
      .eq("company_id", companyId)
      .order("project_name", { ascending: true });
    if (projError) throw projError;

    const projectsRaw = (projData as ProjectQueryRow[]) || [];
    const projectIds = projectsRaw.map((p) => p.id);

    let submissionRows: { project_id: string }[] = [];
    if (projectIds.length > 0) {
      const { data: subData, error: subError } = await supabase
        .from("job_card_submissions")
        .select("project_id")
        .eq("company_id", companyId)
        .in("project_id", projectIds);
      if (subError) throw subError;
      submissionRows = (subData as { project_id: string }[]) || [];
    }

    const countByProject = new Map<string, number>();
    for (const row of submissionRows) {
      const pid = row.project_id;
      if (!pid) continue;
      countByProject.set(pid, (countByProject.get(pid) || 0) + 1);
    }

    const enriched: ProjectCardRow[] = projectsRaw.map((row) => {
      const linked = Array.isArray(row.customers) ? row.customers[0] : row.customers;
      const fromCustomer = linked?.customer_name?.trim() || "";
      const fromProject = row.customer_name?.trim() || "";
      return {
        id: row.id,
        project_name: row.project_name,
        active: row.active,
        displayCustomerName: fromCustomer || fromProject || "—",
        completedSubmissionCount: countByProject.get(row.id) ?? 0,
      };
    });

    setProjects(enriched);
    setLoadError(null);
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!companyId) return;
      if (typeof window === "undefined") return;

      if (!window.navigator.onLine) {
        console.log("[projects] offline detected");
        setLoadError(null);
        try {
          const snap = await getBestStarterSnapshotForOffline(userContext.userId);
          if (cancelled) return;
          if (!snap) {
            console.log("[projects] cached snapshot: not found");
            setOfflineSnapshot(null);
            setOfflineProjectsCacheMiss(true);
            setProjects([]);
            setCompanyName("—");
            setCachedAt(null);
            console.log("[projects] cached project count", companyId, 0);
          } else {
            console.log("[projects] cached snapshot found", { userId: snap.userId });
            const cachedProjects = snap.projectsByCompanyId?.[companyId] || [];
            const cachedCompany = (snap.companies || []).find((company) => company.id === companyId);
            console.log("[projects] cached project count", companyId, cachedProjects.length);
            setOfflineSnapshot(snap);
            const miss = cachedProjects.length === 0;
            setOfflineProjectsCacheMiss(miss);
            setProjects(cachedProjects as ProjectCardRow[]);
            setCompanyName(cachedCompany?.name?.trim() || "—");
            setCachedAt(snap.cachedAt);
          }
        } catch (e) {
          if (!cancelled) {
            console.warn("[projects] offline IndexedDB read failed", e);
            setLoadError("Could not read offline projects cache.");
            setProjects([]);
            setOfflineSnapshot(null);
            setOfflineProjectsCacheMiss(false);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      setOfflineSnapshot(null);
      setOfflineProjectsCacheMiss(false);

      if (authLoading) return;

      if (!userContext.userId) {
        if (!cancelled) {
          setProjects([]);
          setLoadError(null);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) setLoading(true);
      try {
        await loadProjects();
        if (!cancelled) setCachedAt(null);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load projects";
          setLoadError(msg);
          setProjects([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, companyId, isOffline, loadProjects, userContext.userId]);

  const companyRole = useMemo(() => {
    if (isOffline && offlineSnapshot) return offlineSnapshot.profile.companyRolesById[companyId];
    return userContext.companyRolesById[companyId];
  }, [companyId, isOffline, offlineSnapshot, userContext.companyRolesById]);

  const isGlobalAdmin = useMemo(() => {
    if (isOffline && offlineSnapshot) return offlineSnapshot.profile.globalRole === "admin";
    return userContext.globalRole === "admin";
  }, [isOffline, offlineSnapshot, userContext.globalRole]);

  const isActiveCompanyAdmin = companyRole === "admin";
  const canManageCompanyData = isGlobalAdmin || isActiveCompanyAdmin;

  /** Online only: technician assignment fetch. Skip offline to avoid Supabase timeouts. */
  useEffect(() => {
    if (isOffline || (typeof window !== "undefined" && !window.navigator.onLine)) return;
    if (authLoading || !userContext.userId || companyRole !== "technician") return;
    let cancelled = false;
    const loadAssignments = async () => {
      setIsLoadingAssignments(true);
      try {
        const { data, error } = await supabase
          .from("project_assignments")
          .select("project_id")
          .eq("user_id", userContext.userId)
          .eq("is_active", true);
        if (error) throw error;
        if (cancelled) return;
        setAssignedProjectIds(((data as { project_id: string }[]) || []).map((row) => row.project_id).filter(Boolean));
      } catch {
        if (!cancelled) setAssignedProjectIds([]);
      } finally {
        if (!cancelled) setIsLoadingAssignments(false);
      }
    };
    void loadAssignments();
    return () => {
      cancelled = true;
    };
  }, [authLoading, companyRole, isOffline, userContext.userId]);

  const visibleProjects = useMemo(() => {
    if (isOffline && offlineSnapshot) {
      return projects;
    }
    if (authLoading) return [];
    if (!userContext.userId) return [];
    if (companyRole === "admin") return projects;
    if (companyRole === "technician") {
      if (isLoadingAssignments) return projects;
      if (assignedProjectIds.length === 0) return projects;
      const allowed = new Set(assignedProjectIds);
      return projects.filter((project) => allowed.has(project.id));
    }
    return projects;
  }, [
    assignedProjectIds,
    authLoading,
    companyRole,
    isLoadingAssignments,
    isOffline,
    offlineSnapshot,
    projects,
    userContext.userId,
  ]);

  const showAuthBlockingSpinner = !isOffline && authLoading;

  const parsedExternalEmails = useMemo(
    () =>
      externalEmailsInput
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean),
    [externalEmailsInput],
  );

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const digitsOnly = (value: string) => value.replace(/\D/g, "");
  const formatPhoneNumber = (value: string) => {
    const digits = digitsOnly(value).slice(0, 10);
    if (digits.length === 0) return "";
    if (digits.length < 4) return `(${digits}`;
    if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };
  const formatLicenseKey = (value: string) => {
    const digits = digitsOnly(value).slice(0, 11);
    if (digits.length === 0) return "";
    if (digits.length <= 1) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 1)}-${digits.slice(1)}`;
    if (digits.length <= 7) return `${digits.slice(0, 1)}-${digits.slice(1, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 1)}-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  };

  const loadCustomers = useCallback(async () => {
    if (!companyId) return;
    setIsLoadingCustomers(true);
    setCustomerLoadError(null);
    try {
      const { data, error } = await supabase
        .from("customers")
        .select("id, customer_name, full_address")
        .eq("company_id", companyId)
        .order("customer_name", { ascending: true });
      if (error) throw error;
      setCustomers((data as CustomerOption[]) || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load customers";
      setCustomerLoadError(msg);
      setCustomers([]);
    } finally {
      setIsLoadingCustomers(false);
    }
  }, [companyId]);

  const resetAddProjectForm = () => {
    setProjectNameInput("");
    setCustomerNameInput("");
    setLocationInput("");
    setExternalEmailsInput("");
    setAddProjectError(null);
    setSelectedCustomerId(null);
    setCustomerSiteInput("");
  };

  const openAddProjectModal = () => {
    if (isOffline) {
      setAddProjectError("Offline mode: project creation requires connection.");
      return;
    }
    if (!canManageCompanyData) {
      setAddProjectError("Only global admins or active company admins can create projects.");
      return;
    }
    resetAddProjectForm();
    setCustomerLoadError(null);
    setShowAddProjectModal(true);
    void loadCustomers();
  };

  const closeAddProjectModal = () => {
    setShowAddProjectModal(false);
    setAddProjectError(null);
    setShowAddCustomerModal(false);
    setNewCustomerForm(emptyNewCustomerForm());
    setNewCustomerError(null);
  };

  const openAddCustomerModal = () => {
    if (isOffline) {
      setNewCustomerError("Offline mode: customer creation requires connection.");
      return;
    }
    if (!canManageCompanyData) {
      setNewCustomerError("Only global admins or active company admins can create customers/sites from project setup.");
      return;
    }
    setNewCustomerForm({
      ...emptyNewCustomerForm(),
      customer_name: customerSiteInput.trim(),
    });
    setNewCustomerError(null);
    setShowAddCustomerModal(true);
  };

  const closeAddCustomerModal = () => {
    setShowAddCustomerModal(false);
    setNewCustomerError(null);
    setNewCustomerForm(emptyNewCustomerForm());
  };

  const updateNewCustomerField = <K extends keyof NewCustomerForm>(key: K, value: NewCustomerForm[K]) => {
    setNewCustomerForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveNewCustomer = async () => {
    if (isOffline) {
      setNewCustomerError("Offline mode: customer creation requires connection.");
      return;
    }
    if (!canManageCompanyData) {
      setNewCustomerError("Only global admins or active company admins can create customers/sites from project setup.");
      return;
    }
    const name = newCustomerForm.customer_name.trim();
    if (!name) {
      setNewCustomerError("Customer name is required.");
      return;
    }
    if (!companyId) return;

    setIsSavingNewCustomer(true);
    setNewCustomerError(null);
    try {
      const normalizedName = name.toLowerCase();
      const { data: existingCustomers, error: existingLookupError } = await supabase
        .from("customers")
        .select("id, customer_name, full_address")
        .eq("company_id", companyId);
      if (existingLookupError) throw existingLookupError;

      const existingMatch = ((existingCustomers as CustomerOption[]) || []).find(
        (customer) => (customer.customer_name || "").trim().toLowerCase() === normalizedName,
      );
      if (existingMatch) {
        setSelectedCustomerId(existingMatch.id);
        const existingName = existingMatch.customer_name?.trim() || name;
        const existingAddress = existingMatch.full_address?.trim() || "";
        setCustomerSiteInput(existingName);
        setCustomerNameInput(existingName);
        setLocationInput(existingAddress);
        closeAddCustomerModal();
        return;
      }

      const row = {
        company_id: companyId,
        customer_name: name,
        full_address: newCustomerForm.full_address.trim() || null,
        site_contact_name: newCustomerForm.site_contact_name.trim() || null,
        contact_number: newCustomerForm.contact_number.trim() || null,
        license_key_1: newCustomerForm.license_key_1.trim() || null,
        license_key_2: newCustomerForm.license_key_2.trim() || null,
        server_port_type: newCustomerForm.server_port_type || null,
        server_port_number: newCustomerForm.server_port_number.trim() || null,
        facility_code: newCustomerForm.facility_code.trim() || null,
        wifi_ssid: newCustomerForm.wifi_ssid.trim() || null,
        wifi_password: newCustomerForm.wifi_password.trim() || null,
        notes: newCustomerForm.notes.trim() || null,
      };
      const { data, error } = await supabase.from("customers").insert(row).select("id, customer_name, full_address").single();
      if (error) throw error;
      const created = data as CustomerOption;
      await loadCustomers();
      setSelectedCustomerId(created.id);
      const createdName = created.customer_name?.trim() || "";
      const createdAddress = created.full_address?.trim() || "";
      setCustomerSiteInput(createdName);
      setCustomerNameInput(createdName);
      setLocationInput(createdAddress);
      closeAddCustomerModal();
    } catch (e) {
      const maybeDbError = e as { code?: string; message?: string; details?: string } | null;
      const detailsText = `${maybeDbError?.message || ""} ${maybeDbError?.details || ""}`.toLowerCase();
      const isDuplicateCustomerName =
        maybeDbError?.code === "23505" ||
        detailsText.includes("idx_customers_company_normalized_customer_name") ||
        detailsText.includes("duplicate key");
      if (isDuplicateCustomerName) {
        setNewCustomerError("Customer already exists.");
      } else {
        const msg = e instanceof Error ? e.message : "Failed to save customer";
        setNewCustomerError(msg);
      }
    } finally {
      setIsSavingNewCustomer(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    const query = customerSiteInput.trim().toLowerCase();
    if (!query) return [];
    return customers.filter((customer) => (customer.customer_name || "").trim().toLowerCase().includes(query));
  }, [customers, customerSiteInput]);

  const handleCustomerSiteFieldChange = (value: string) => {
    setCustomerSiteInput(value);
    const trimmed = value.trim();
    if (selectedCustomerId) {
      const current = customers.find((c) => c.id === selectedCustomerId);
      const currentName = (current?.customer_name || "").trim().toLowerCase();
      if (!trimmed || trimmed.toLowerCase() !== currentName) {
        setSelectedCustomerId(null);
        setCustomerNameInput(value);
      } else {
        setCustomerNameInput((current?.customer_name || "").trim());
      }
    } else {
      setCustomerNameInput(value);
    }
  };

  const handleSaveNewProject = async () => {
    if (isOffline) {
      setAddProjectError("Offline mode: project creation requires connection.");
      return;
    }
    if (!canManageCompanyData) {
      setAddProjectError("Only global admins or active company admins can create projects.");
      return;
    }
    const projectName = projectNameInput.trim();
    const customerName = customerNameInput.trim();
    const location = locationInput.trim();
    if (!projectName) {
      setAddProjectError("Project Name is required.");
      return;
    }
    if (!customerName) {
      setAddProjectError("Customer / Site is required.");
      return;
    }
    if (!location) {
      setAddProjectError("Location is required.");
      return;
    }
    const invalidEmail = parsedExternalEmails.find((email) => !isValidEmail(email));
    if (invalidEmail) {
      setAddProjectError(`Invalid email format: ${invalidEmail}`);
      return;
    }

    setIsSavingProject(true);
    setAddProjectError(null);
    try {
      const { error } = await supabase.from("projects").insert({
        company_id: companyId,
        customer_id: selectedCustomerId,
        project_name: projectName,
        customer_name: customerName,
        location,
        external_recipient_emails: parsedExternalEmails,
        active: true,
      });
      if (error) throw error;
      await loadProjects();
      closeAddProjectModal();
      resetAddProjectForm();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save project";
      setAddProjectError(msg);
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleCustomerSelectionChange = (customer: CustomerOption | null) => {
    if (!customer) {
      setSelectedCustomerId(null);
      setCustomerNameInput(customerSiteInput);
      return;
    }
    setSelectedCustomerId(customer.id);
    const selectedName = customer.customer_name?.trim() || "";
    const selectedAddress = customer.full_address?.trim() || "";
    setCustomerSiteInput(selectedName);
    if (selectedName) setCustomerNameInput(selectedName);
    if (selectedAddress) setLocationInput(selectedAddress);
  };

  const openProjectDashboard = (projectId: string) => {
    try {
      window.localStorage.setItem(SELECTED_COMPANY_ID_KEY, companyId);
      window.localStorage.setItem(SELECTED_PROJECT_ID_KEY, projectId);
    } catch {
      // ignore storage errors
    }
    router.push(`/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}`);
  };

  useEffect(() => {
    if (!userContext.userId || authLoading || isOffline) return;
    void upsertStarterDataSnapshot(userContext.userId, (prev) => ({
      userId: userContext.userId!,
      cachedAt: new Date().toISOString(),
      profile: {
        globalRole: userContext.globalRole,
        companyIds: [...userContext.companyIds],
        companyRolesById: { ...userContext.companyRolesById },
      },
      companies: prev?.companies || [],
      projectsByCompanyId: {
        ...(prev?.projectsByCompanyId || {}),
        [companyId]: visibleProjects.map((project) => ({
          id: project.id,
          project_name: project.project_name,
          active: project.active,
          displayCustomerName: project.displayCustomerName,
          completedSubmissionCount: project.completedSubmissionCount,
        })),
      },
    })).catch(() => {
      // ignore IndexedDB cache write errors
    });
  }, [authLoading, companyId, isOffline, userContext, visibleProjects]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <p className="text-center text-lg font-semibold text-gray-700 dark:text-gray-300">Company: {companyName}</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Select Project</h1>
          <p className="mt-1 text-sm text-gray-600">Choose a project for this company.</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link href="/companies" className="inline-flex text-sm font-semibold text-blue-700 hover:underline">
                Back to Companies
              </Link>
              <Link
                href={`/companies/${encodeURIComponent(companyId)}/customers`}
                className="inline-flex text-sm font-semibold text-blue-700 hover:underline"
              >
                Customers / Sites
              </Link>
              {canManageCompanyData ? (
                isOffline ? (
                  <span className="inline-flex text-sm font-semibold text-gray-500">Assignments (online only)</span>
                ) : (
                  <Link
                    href={`/companies/${encodeURIComponent(companyId)}/assignments`}
                    className="inline-flex text-sm font-semibold text-blue-700 hover:underline"
                  >
                    Assignments
                  </Link>
                )
              ) : null}
            </div>
            {canManageCompanyData ? (
              <button
                type="button"
                onClick={openAddProjectModal}
                disabled={isOffline}
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
              >
                {isOffline ? "Add New Project (online only)" : "Add New Project"}
              </button>
            ) : null}
          </div>
        </header>

        {loading || showAuthBlockingSpinner ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
            {showAuthBlockingSpinner ? "Checking sign-in…" : "Loading projects…"}
          </section>
        ) : null}
        {!loading && !showAuthBlockingSpinner && isOffline && offlineSnapshot && !offlineProjectsCacheMiss ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">Offline — showing cached projects</p>
            {cachedAt ? <p className="mt-1 text-xs">Cached data from {new Date(cachedAt).toLocaleString()}</p> : null}
          </section>
        ) : null}
        {!loading && !showAuthBlockingSpinner && isOffline && offlineProjectsCacheMiss && !loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">No cached projects found. Open this company online once before using offline.</p>
          </section>
        ) : null}
        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Could not load projects: {loadError}
          </section>
        ) : null}

        {!loading && !loadError && !showAuthBlockingSpinner ? (
          visibleProjects.length === 0 ? (
            isOffline && offlineProjectsCacheMiss ? null : (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
              <p>
                {isOffline && offlineSnapshot
                  ? "No projects match your cached list for this company."
                  : !userContext.userId
                    ? "Log in to view projects for this company."
                    : "No projects found for this company."}
              </p>
              {canManageCompanyData ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {isOffline ? (
                    <span className="inline-flex rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-500">
                      Manage Users / Assignments (online only)
                    </span>
                  ) : (
                    <Link
                      href={`/companies/${encodeURIComponent(companyId)}/assignments`}
                      className="inline-flex rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      Manage Users / Assignments
                    </Link>
                  )}
                  <Link
                    href={`/companies/${encodeURIComponent(companyId)}/customers`}
                    className="inline-flex rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    Customers / Sites
                  </Link>
                  <button
                    type="button"
                    onClick={openAddProjectModal}
                    disabled={isOffline}
                    className="inline-flex rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    {isOffline ? "Add Project (online only)" : "Add Project"}
                  </button>
                </div>
              ) : null}
            </section>
            )
          ) : (
            visibleProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => openProjectDashboard(project.id)}
                className="block w-full rounded-2xl border border-indigo-200 bg-white p-5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                <h2 className="text-lg font-bold text-gray-900">{project.project_name}</h2>
                <p className="mt-1 text-sm text-gray-700">
                  <span className="font-semibold text-gray-600">Customer:</span> {project.displayCustomerName}
                </p>
                <p className="mt-0.5 text-sm text-gray-700">
                  <span className="font-semibold text-gray-600">Completed submissions:</span>{" "}
                  {project.completedSubmissionCount}
                </p>
                <p className="mt-1 text-sm text-gray-600">{project.active ? "Active project" : "Inactive project"}</p>
              </button>
            ))
          )
        ) : null}

        {showAddProjectModal ? (
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 p-4 sm:items-center"
            role="presentation"
            onClick={closeAddProjectModal}
          >
            <section
              className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-xl sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-project-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="add-project-title" className="text-xl font-bold text-gray-950">
                Add New Project
              </h2>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Project Name</label>
                  <input
                    value={projectNameInput}
                    onChange={(e) => setProjectNameInput(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="e.g. East Yard Rollout"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Customer / Site</label>
                  <input
                    value={customerSiteInput}
                    onChange={(e) => handleCustomerSiteFieldChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="Search customers or enter a new customer / site name"
                    disabled={isLoadingCustomers}
                    autoComplete="off"
                  />
                  {isLoadingCustomers ? <p className="mt-1 text-xs text-gray-500">Loading customers...</p> : null}
                  {customerLoadError ? <p className="mt-1 text-xs font-semibold text-amber-700">{customerLoadError}</p> : null}
                  {!isLoadingCustomers && !customerLoadError ? (
                    <>
                      {filteredCustomers.length > 0 ? (
                        <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-900">
                          {filteredCustomers.map((customer) => (
                            <button
                              key={customer.id}
                              type="button"
                              onClick={() => handleCustomerSelectionChange(customer)}
                              className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-800 ${
                                selectedCustomerId === customer.id
                                  ? "bg-blue-50 font-semibold text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                                  : "text-gray-800 dark:text-slate-100"
                              }`}
                            >
                              {customer.customer_name?.trim() || "Unnamed customer"}
                            </button>
                          ))}
                          {canManageCompanyData ? (
                            <button
                              type="button"
                              onClick={openAddCustomerModal}
                              className="block w-full border-t border-gray-200 bg-emerald-50/80 px-3 py-2 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100"
                            >
                              + Add New Customer / Site
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {canManageCompanyData && customerSiteInput.trim() && filteredCustomers.length === 0 ? (
                        <button
                          type="button"
                          onClick={openAddCustomerModal}
                          className="mt-2 inline-flex w-fit rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
                        >
                          + Add New Customer / Site
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Location</label>
                  <input
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="e.g. Acworth, GA"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">External Recipient Emails</label>
                  <input
                    value={externalEmailsInput}
                    onChange={(e) => setExternalEmailsInput(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="name@company.com, ops@company.com"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="mt-1 text-xs text-gray-500">Optional. Enter comma-separated emails.</p>
                </div>
              </div>
              {addProjectError ? <p className="mt-3 text-sm font-semibold text-red-700">{addProjectError}</p> : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeAddProjectModal}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  disabled={isSavingProject}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveNewProject()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={isSavingProject}
                >
                  {isSavingProject ? "Saving..." : "Save Project"}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {showAddProjectModal && showAddCustomerModal ? (
          <div
            className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 p-4 sm:items-center"
            role="presentation"
            onClick={closeAddCustomerModal}
          >
            <section
              className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-gray-200 bg-white shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-customer-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
                <h2 id="add-customer-title" className="text-xl font-bold text-gray-950">
                  Add New Customer / Site
                </h2>
                <p className="mt-1 text-sm text-gray-600">Creates a customer record for this company. Project save still uses name and location below.</p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Customer name</label>
                    <input
                      value={newCustomerForm.customer_name}
                      onChange={(e) => updateNewCustomerField("customer_name", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      placeholder="Required"
                      autoComplete="organization"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Full address</label>
                    <input
                      value={newCustomerForm.full_address}
                      onChange={(e) => updateNewCustomerField("full_address", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      autoComplete="street-address"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Site contact name</label>
                    <input
                      value={newCustomerForm.site_contact_name}
                      onChange={(e) => updateNewCustomerField("site_contact_name", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Contact number</label>
                    <input
                      value={newCustomerForm.contact_number}
                      onChange={(e) => updateNewCustomerField("contact_number", formatPhoneNumber(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">License key 1</label>
                    <input
                      value={newCustomerForm.license_key_1}
                      onChange={(e) => updateNewCustomerField("license_key_1", formatLicenseKey(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">License key 2</label>
                    <input
                      value={newCustomerForm.license_key_2}
                      onChange={(e) => updateNewCustomerField("license_key_2", formatLicenseKey(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Server port type</label>
                    <select
                      value={newCustomerForm.server_port_type}
                      onChange={(e) =>
                        updateNewCustomerField("server_port_type", e.target.value as NewCustomerForm["server_port_type"])
                      }
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="">—</option>
                      <option value="TLS">TLS</option>
                      <option value="Proprietary">Proprietary</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Server port number</label>
                    <input
                      value={newCustomerForm.server_port_number}
                      onChange={(e) =>
                        updateNewCustomerField("server_port_number", digitsOnly(e.target.value).slice(0, 5))
                      }
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Facility code</label>
                    <input
                      value={newCustomerForm.facility_code}
                      onChange={(e) => updateNewCustomerField("facility_code", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Wi-Fi SSID</label>
                    <input
                      value={newCustomerForm.wifi_ssid}
                      onChange={(e) => updateNewCustomerField("wifi_ssid", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Wi-Fi password</label>
                    <input
                      type="password"
                      value={newCustomerForm.wifi_password}
                      onChange={(e) => updateNewCustomerField("wifi_password", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Notes</label>
                    <textarea
                      value={newCustomerForm.notes}
                      onChange={(e) => updateNewCustomerField("notes", e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
                {newCustomerError ? <p className="mt-3 text-sm font-semibold text-red-700">{newCustomerError}</p> : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-5 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={closeAddCustomerModal}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  disabled={isSavingNewCustomer}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveNewCustomer()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={isSavingNewCustomer}
                >
                  {isSavingNewCustomer ? "Saving..." : "Save customer"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

