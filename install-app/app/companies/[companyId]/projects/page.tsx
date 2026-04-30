"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";

type ProjectRow = {
  id: string;
  project_name: string;
  active: boolean;
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
  const companyId = String(params.companyId || "");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
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
  }, [companyId]);

  const loadProjects = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from("projects")
      .select("id, project_name, active")
      .eq("company_id", companyId)
      .order("project_name", { ascending: true });
    if (error) throw error;
    setProjects((data as ProjectRow[]) || []);
    setLoadError(null);
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!companyId) return;
      try {
        await loadProjects();
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
  }, [companyId, loadProjects]);

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
    const name = newCustomerForm.customer_name.trim();
    if (!name) {
      setNewCustomerError("Customer name is required.");
      return;
    }
    if (!companyId) return;

    setIsSavingNewCustomer(true);
    setNewCustomerError(null);
    try {
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
      const msg = e instanceof Error ? e.message : "Failed to save customer";
      setNewCustomerError(msg);
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

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <p className="text-center text-lg font-semibold text-gray-700 dark:text-gray-300">Company: {companyName}</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Select Project</h1>
          <p className="mt-1 text-sm text-gray-600">Choose a project for this company.</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Link href="/companies" className="inline-flex text-sm font-semibold text-blue-700 hover:underline">
              Back to Companies
            </Link>
            {/* TODO: Restrict project creation to admin-only users when auth/roles are introduced. */}
            <button
              type="button"
              onClick={openAddProjectModal}
              className="inline-flex min-h-[40px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
            >
              Add New Project
            </button>
          </div>
        </header>

        {loading ? <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">Loading projects...</section> : null}
        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Could not load projects: {loadError}
          </section>
        ) : null}

        {!loading && !loadError ? (
          projects.length === 0 ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
              No projects found for this company.
            </section>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => openProjectDashboard(project.id)}
                className="block w-full rounded-2xl border border-indigo-200 bg-white p-5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                <h2 className="text-lg font-bold text-gray-900">{project.project_name}</h2>
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    placeholder="e.g. East Yard Rollout"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Customer / Site</label>
                  <input
                    value={customerSiteInput}
                    onChange={(e) => handleCustomerSiteFieldChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    placeholder="Search customers or enter a new customer / site name"
                    disabled={isLoadingCustomers}
                    autoComplete="off"
                  />
                  {isLoadingCustomers ? <p className="mt-1 text-xs text-gray-500">Loading customers...</p> : null}
                  {customerLoadError ? <p className="mt-1 text-xs font-semibold text-amber-700">{customerLoadError}</p> : null}
                  {!isLoadingCustomers && !customerLoadError ? (
                    <>
                      {filteredCustomers.length > 0 ? (
                        <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-200">
                          {filteredCustomers.map((customer) => (
                            <button
                              key={customer.id}
                              type="button"
                              onClick={() => handleCustomerSelectionChange(customer)}
                              className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                                selectedCustomerId === customer.id ? "bg-blue-50 font-semibold text-blue-800" : "text-gray-800"
                              }`}
                            >
                              {customer.customer_name?.trim() || "Unnamed customer"}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={openAddCustomerModal}
                            className="block w-full border-t border-gray-200 bg-emerald-50/80 px-3 py-2 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100"
                          >
                            ➕ Add New Customer / Site
                          </button>
                        </div>
                      ) : null}
                      {customerSiteInput.trim() && filteredCustomers.length === 0 ? (
                        <button
                          type="button"
                          onClick={openAddCustomerModal}
                          className="mt-2 inline-flex w-fit rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
                        >
                          ➕ Add New Customer / Site
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    placeholder="e.g. Acworth, GA"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">External Recipient Emails</label>
                  <input
                    value={externalEmailsInput}
                    onChange={(e) => setExternalEmailsInput(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    placeholder="name@company.com, ops@company.com"
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
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                      placeholder="Required"
                      autoComplete="organization"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Full address</label>
                    <input
                      value={newCustomerForm.full_address}
                      onChange={(e) => updateNewCustomerField("full_address", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                      autoComplete="street-address"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Site contact name</label>
                    <input
                      value={newCustomerForm.site_contact_name}
                      onChange={(e) => updateNewCustomerField("site_contact_name", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Contact number</label>
                    <input
                      value={newCustomerForm.contact_number}
                      onChange={(e) => updateNewCustomerField("contact_number", formatPhoneNumber(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">License key 1</label>
                    <input
                      value={newCustomerForm.license_key_1}
                      onChange={(e) => updateNewCustomerField("license_key_1", formatLicenseKey(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">License key 2</label>
                    <input
                      value={newCustomerForm.license_key_2}
                      onChange={(e) => updateNewCustomerField("license_key_2", formatLicenseKey(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
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
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
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
                      onChange={(e) => updateNewCustomerField("server_port_number", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Facility code</label>
                    <input
                      value={newCustomerForm.facility_code}
                      onChange={(e) => updateNewCustomerField("facility_code", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Wi-Fi SSID</label>
                    <input
                      value={newCustomerForm.wifi_ssid}
                      onChange={(e) => updateNewCustomerField("wifi_ssid", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Wi-Fi password</label>
                    <input
                      type="password"
                      value={newCustomerForm.wifi_password}
                      onChange={(e) => updateNewCustomerField("wifi_password", e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-800">Notes</label>
                    <textarea
                      value={newCustomerForm.notes}
                      onChange={(e) => updateNewCustomerField("notes", e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
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

