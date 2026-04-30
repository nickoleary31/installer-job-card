"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import CustomerEditorForm from "../../_components/CustomerEditorForm";
import {
  CustomerFormState,
  CustomerRecord,
  emptyCustomerForm,
  isDuplicateCustomerNameError,
  toCustomerUpdatePayload,
  toFormState,
} from "../../_lib/customerForm";

export default function CustomerEditPage() {
  const params = useParams<{ companyId: string; customerId: string }>();
  const router = useRouter();
  const companyId = String(params.companyId || "");
  const customerId = String(params.customerId || "");
  const [form, setForm] = useState<CustomerFormState>(emptyCustomerForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
          setForm(emptyCustomerForm());
          return;
        }
        setForm(toFormState(data));
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load customer";
          setLoadError(msg);
          setForm(emptyCustomerForm());
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

  const updateField = <K extends keyof CustomerFormState>(key: K, value: CustomerFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const customerName = form.customer_name.trim();
    if (!customerName) {
      setSaveError("Customer name is required.");
      return;
    }
    if (!companyId || !customerId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = toCustomerUpdatePayload(form);
      const { error } = await supabase.from("customers").update(payload).eq("id", customerId).eq("company_id", companyId);
      if (error) throw error;
      router.push(`/companies/${encodeURIComponent(companyId)}/customers/${encodeURIComponent(customerId)}?saved=1`);
    } catch (e) {
      if (isDuplicateCustomerNameError(e)) {
        setSaveError("Customer already exists.");
      } else {
        const msg = e instanceof Error ? e.message : "Failed to save customer";
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-xl font-bold tracking-tight text-gray-950">Edit Customer / Site</h1>
          <p className="mt-2 text-sm text-gray-600">Update customer and site details for this company.</p>
          <div className="mt-4">
            <Link
              href={`/companies/${encodeURIComponent(companyId)}/customers/${encodeURIComponent(customerId)}`}
              className="inline-flex text-sm font-semibold text-blue-700 hover:underline"
            >
              ← Back to Customer / Site
            </Link>
          </div>
        </header>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          {loading ? <p className="text-sm text-gray-600">Loading customer...</p> : null}
          {loadError ? <p className="text-sm font-semibold text-red-700">{loadError}</p> : null}
          {!loading && !loadError ? (
            <>
              <CustomerEditorForm form={form} onChange={updateField} />
              {saveError ? <p className="mt-3 text-sm font-semibold text-red-700">{saveError}</p> : null}
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

