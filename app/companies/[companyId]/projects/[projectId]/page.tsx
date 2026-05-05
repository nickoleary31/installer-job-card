"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";

const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";

type ProjectContext = {
  companyName: string;
  projectName: string;
  customerName: string;
  location: string;
};

type ProjectContextRow = {
  project_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  location: string | null;
  customers: CustomerContextRow | CustomerContextRow[] | null;
};

type CustomerContextRow = {
  customer_name: string | null;
  full_address: string | null;
  site_contact_name: string | null;
  contact_number: string | null;
  license_key_1: string | null;
  license_key_2: string | null;
  server_port_type: string | null;
  server_port_number: string | null;
  facility_code: string | null;
  wifi_ssid: string | null;
  wifi_password: string | null;
  notes: string | null;
};

type SiteInfo = {
  customer_name: string;
  full_address: string;
  site_contact_name: string;
  contact_number: string;
  license_key_1: string;
  license_key_2: string;
  server_port_type: string;
  server_port_number: string;
  facility_code: string;
  wifi_ssid: string;
  wifi_password: string;
  notes: string;
};

const emptySiteInfo: SiteInfo = {
  customer_name: "—",
  full_address: "—",
  site_contact_name: "—",
  contact_number: "—",
  license_key_1: "—",
  license_key_2: "—",
  server_port_type: "—",
  server_port_number: "—",
  facility_code: "—",
  wifi_ssid: "—",
  wifi_password: "—",
  notes: "—",
};

const displayCell = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
};

export default function ProjectDashboardPage() {
  const params = useParams<{ companyId: string; projectId: string }>();
  const { loading: authLoading, context: userContext } = useAuthUserContext();
  const companyId = String(params.companyId || "");
  const projectId = String(params.projectId || "");
  const [projectContext, setProjectContext] = useState<ProjectContext>({
    companyName: "—",
    projectName: "—",
    customerName: "—",
    location: "—",
  });
  const [siteInfoExpanded, setSiteInfoExpanded] = useState(false);
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [siteInfo, setSiteInfo] = useState<SiteInfo>(emptySiteInfo);
  const [hasLinkedCustomer, setHasLinkedCustomer] = useState(false);

  useEffect(() => {
    try {
      if (companyId) window.localStorage.setItem(SELECTED_COMPANY_ID_KEY, companyId);
      if (projectId) window.localStorage.setItem(SELECTED_PROJECT_ID_KEY, projectId);
    } catch {
      // ignore storage errors
    }
  }, [companyId, projectId]);

  useEffect(() => {
    let cancelled = false;
    const loadProjectContext = async () => {
      if (!companyId || !projectId) return;
      if (authLoading) return;
      if (!userContext.userId) {
        if (!cancelled) {
          setProjectContext({
            companyName: "—",
            projectName: "—",
            customerName: "—",
            location: "—",
          });
          setHasLinkedCustomer(false);
          setSiteInfo(emptySiteInfo);
          setShowWifiPassword(false);
        }
        return;
      }
      try {
        const [{ data: companyRow, error: companyError }, { data: projectRow, error: projectError }] = await Promise.all([
          supabase.from("companies").select("name").eq("id", companyId).maybeSingle<{ name: string }>(),
          supabase
            .from("projects")
            .select(
              "project_name, customer_id, customer_name, location, customers:customer_id(customer_name, full_address, site_contact_name, contact_number, license_key_1, license_key_2, server_port_type, server_port_number, facility_code, wifi_ssid, wifi_password, notes)",
            )
            .eq("id", projectId)
            .eq("company_id", companyId)
            .maybeSingle<ProjectContextRow>(),
        ]);
        if (companyError || projectError || cancelled) return;
        if (!companyRow && !projectRow) return;

        let customerName = projectRow?.customer_name?.trim() || "—";
        let location = projectRow?.location?.trim() || "—";
        if (projectRow?.customer_id) {
          const customerLookup = Array.isArray(projectRow.customers) ? projectRow.customers[0] : projectRow.customers;
          const customerNameFromCustomer = customerLookup?.customer_name?.trim();
          const locationFromCustomer = customerLookup?.full_address?.trim();
          if (customerNameFromCustomer) customerName = customerNameFromCustomer;
          if (locationFromCustomer) location = locationFromCustomer;

          setHasLinkedCustomer(!!customerLookup);
          setSiteInfo({
            customer_name: displayCell(customerLookup?.customer_name),
            full_address: displayCell(customerLookup?.full_address),
            site_contact_name: displayCell(customerLookup?.site_contact_name),
            contact_number: displayCell(customerLookup?.contact_number),
            license_key_1: displayCell(customerLookup?.license_key_1),
            license_key_2: displayCell(customerLookup?.license_key_2),
            server_port_type: displayCell(customerLookup?.server_port_type),
            server_port_number: displayCell(customerLookup?.server_port_number),
            facility_code: displayCell(customerLookup?.facility_code),
            wifi_ssid: displayCell(customerLookup?.wifi_ssid),
            wifi_password: displayCell(customerLookup?.wifi_password),
            notes: displayCell(customerLookup?.notes),
          });
        } else {
          setHasLinkedCustomer(false);
          setSiteInfo(emptySiteInfo);
          setShowWifiPassword(false);
        }

        setProjectContext({
          companyName: companyRow?.name?.trim() || "—",
          projectName: projectRow?.project_name?.trim() || "—",
          customerName,
          location,
        });
      } catch {
        // keep fallback display values
      }
    };
    void loadProjectContext();
    return () => {
      cancelled = true;
    };
  }, [authLoading, companyId, projectId, userContext.userId]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-5 sm:py-2">
        <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Installer Sheetz</h1>
          <p className="text-base font-medium leading-tight text-gray-600">Digital Job Cards for Field Technicians</p>
          <Link
            href={`/companies/${encodeURIComponent(companyId)}/projects`}
            className="mt-3 inline-flex text-sm font-semibold text-blue-700 hover:underline"
          >
            Back to Projects
          </Link>
        </header>

        {authLoading ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            Checking sign-in…
          </section>
        ) : null}

        {!authLoading && !userContext.userId ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-700 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            <p className="font-semibold text-gray-900">Sign in required</p>
            <p className="mt-2 text-gray-600">Log in to view this project and job card tools.</p>
            <Link href="/login" className="mt-4 inline-flex text-sm font-semibold text-blue-700 hover:underline">
              Go to login
            </Link>
          </section>
        ) : null}

        {!authLoading && userContext.userId ? (
          <>
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Current Project</h2>
          <div className="mt-3 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
            <p>
              <span className="font-semibold text-gray-600">Company:</span> {projectContext.companyName}
            </p>
            <p>
              <span className="font-semibold text-gray-600">Project:</span> {projectContext.projectName}
            </p>
            <p>
              <span className="font-semibold text-gray-600">Customer:</span> {projectContext.customerName}
            </p>
            <p>
              <span className="font-semibold text-gray-600">Location:</span> {projectContext.location}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <button
            type="button"
            onClick={() => setSiteInfoExpanded((prev) => !prev)}
            className="flex w-full items-center justify-between text-left"
            aria-expanded={siteInfoExpanded}
          >
            <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Site Info</h2>
            <span className="text-sm text-gray-600">{siteInfoExpanded ? "▾" : "▸"}</span>
          </button>

          {siteInfoExpanded ? (
            hasLinkedCustomer ? (
              <div className="mt-4 grid gap-3 text-sm text-gray-800 sm:grid-cols-2">
                <p><span className="font-semibold text-gray-600">Customer / Site:</span> {siteInfo.customer_name}</p>
                <p><span className="font-semibold text-gray-600">Full address:</span> {siteInfo.full_address}</p>
                <p><span className="font-semibold text-gray-600">Site contact:</span> {siteInfo.site_contact_name}</p>
                <p><span className="font-semibold text-gray-600">Contact number:</span> {siteInfo.contact_number}</p>
                <p><span className="font-semibold text-gray-600">License key 1:</span> {siteInfo.license_key_1}</p>
                <p><span className="font-semibold text-gray-600">License key 2:</span> {siteInfo.license_key_2}</p>
                <p><span className="font-semibold text-gray-600">Server port type:</span> {siteInfo.server_port_type}</p>
                <p><span className="font-semibold text-gray-600">Server port number:</span> {siteInfo.server_port_number}</p>
                <p><span className="font-semibold text-gray-600">Facility code:</span> {siteInfo.facility_code}</p>
                <p><span className="font-semibold text-gray-600">Wi-Fi SSID:</span> {siteInfo.wifi_ssid}</p>
                <div className="sm:col-span-2">
                  <p className="font-semibold text-gray-600">Wi-Fi password:</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                      {showWifiPassword ? siteInfo.wifi_password : siteInfo.wifi_password === "—" ? "—" : "••••••••"}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowWifiPassword((prev) => !prev)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      {showWifiPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <p className="font-semibold text-gray-600">Notes:</p>
                  <p className="mt-1 min-h-20 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                    {siteInfo.notes}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-600">No linked customer/site record found for this project.</p>
            )
          ) : null}
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/new-submission"
            className="rounded-2xl border border-blue-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-blue-300 hover:bg-blue-50/50 sm:p-6"
          >
            <h2 className="text-lg font-bold text-gray-900">New Submission</h2>
            <p className="mt-1 text-sm text-gray-600">Start a new installer job card.</p>
          </Link>

          <Link
            href="/drafts"
            className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-emerald-300 hover:bg-emerald-50/50 sm:p-6"
          >
            <h2 className="text-lg font-bold text-gray-900">Saved Drafts</h2>
            <p className="mt-1 text-sm text-gray-600">Resume or manage unfinished job cards.</p>
          </Link>

          <Link
            href="/submitted"
            className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-indigo-300 hover:bg-indigo-50/50 sm:p-6"
          >
            <h2 className="text-lg font-bold text-gray-900">Submitted Job Cards</h2>
            <p className="mt-1 text-sm text-gray-600">View completed submissions.</p>
          </Link>
        </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

