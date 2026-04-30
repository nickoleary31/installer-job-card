"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { CustomerRecord } from "../_lib/customerForm";

const displayCell = (value: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
};

export default function CustomerDetailPage() {
  const params = useParams<{ companyId: string; customerId: string }>();
  const companyId = String(params.companyId || "");
  const customerId = String(params.customerId || "");
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId || !customerId) return;
    let cancelled = false;
    const loadCustomer = async () => {
      setLoadError(null);
      try {
        const { data, error } = await supabase
          .from("customers")
          .select(
            "customer_name, full_address, site_contact_name, contact_number, license_key_1, license_key_2, server_port_type, server_port_number, facility_code, wifi_ssid, wifi_password, notes",
          )
          .eq("id", customerId)
          .eq("company_id", companyId)
          .maybeSingle<CustomerRecord>();
        if (cancelled) return;
        if (error) throw error;
        if (!data) {
          setLoadError("Customer not found for this company.");
          setCustomer(null);
          return;
        }
        setCustomer(data);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load customer";
          setLoadError(msg);
          setCustomer(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadCustomer();
    return () => {
      cancelled = true;
    };
  }, [companyId, customerId]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-xl font-bold tracking-tight text-gray-950">Customer / Site</h1>
          <p className="mt-2 text-sm text-gray-600">View customer and site details for this company.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/companies/${encodeURIComponent(companyId)}/customers`}
              className="inline-flex text-sm font-semibold text-blue-700 hover:underline"
            >
              ← Back to Customers / Sites
            </Link>
            {!loadError ? (
              <Link
                href={`/companies/${encodeURIComponent(companyId)}/customers/${encodeURIComponent(customerId)}/edit`}
                className="inline-flex rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"
              >
                Edit
              </Link>
            ) : null}
          </div>
        </header>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          {loading ? <p className="text-sm text-gray-600">Loading customer...</p> : null}
          {loadError ? <p className="text-sm font-semibold text-red-700">{loadError}</p> : null}

          {!loading && !loadError && customer ? (
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">Customer name</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.customer_name)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">Full address</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.full_address)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">Site contact name</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.site_contact_name)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">Contact number</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.contact_number)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">License key 1</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.license_key_1)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">License key 2</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.license_key_2)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">Server port type</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.server_port_type)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">Server port number</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.server_port_number)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">Facility code</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.facility_code)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">Wi-Fi SSID</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.wifi_ssid)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">Wi-Fi password</p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.wifi_password)}
                </p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-800">Notes</p>
                <p className="min-h-20 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
                  {displayCell(customer.notes)}
                </p>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
