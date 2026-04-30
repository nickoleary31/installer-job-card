"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import CustomerEditorForm from "../_components/CustomerEditorForm";
import {
  CustomerFormState,
  emptyCustomerForm,
  isDuplicateCustomerNameError,
  toCustomerUpdatePayload,
} from "../_lib/customerForm";

export default function CustomerNewPage() {
  const params = useParams<{ companyId: string }>();
  const router = useRouter();
  const companyId = String(params.companyId || "");
  const [form, setForm] = useState<CustomerFormState>(emptyCustomerForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateField = <K extends keyof CustomerFormState>(key: K, value: CustomerFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const customerName = form.customer_name.trim();
    if (!customerName) {
      setSaveError("Customer name is required.");
      return;
    }
    if (!companyId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        company_id: companyId,
        ...toCustomerUpdatePayload(form),
      };
      const { error } = await supabase.from("customers").insert(payload);
      if (error) throw error;
      router.push(`/companies/${encodeURIComponent(companyId)}/customers?created=1`);
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
          <h1 className="text-xl font-bold tracking-tight text-gray-950">New Customer / Site</h1>
          <p className="mt-2 text-sm text-gray-600">Create a customer/site for this company.</p>
          <div className="mt-4">
            <Link
              href={`/companies/${encodeURIComponent(companyId)}/customers`}
              className="inline-flex text-sm font-semibold text-blue-700 hover:underline"
            >
              ← Back to Customers / Sites
            </Link>
          </div>
        </header>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
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
        </section>
      </div>
    </main>
  );
}

