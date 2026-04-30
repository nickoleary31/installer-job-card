"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
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
  const { loading: authLoading, context: userContext } = useAuthUserContext();
  const companyId = String(params.companyId || "");
  const customerId = String(params.customerId || "");
  const [form, setForm] = useState<CustomerFormState>(emptyCustomerForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [accessRestricted, setAccessRestricted] = useState(false);
  const companyRole = userContext.companyRolesById[companyId];
  const isAdminForCompany = companyRole === "admin";
  const isTechnicianForCompany = companyRole === "technician";
  const technicianEditableFields: Array<keyof CustomerFormState> = ["wifi_ssid", "wifi_password"];
  const technicianVisibleFields: Array<keyof CustomerFormState> = ["wifi_ssid", "wifi_password"];

  useEffect(() => {
    if (!companyId || !customerId) return;
    if (authLoading) return;
    let cancelled = false;
    const loadCustomer = async () => {
      setLoadError(null);
      setAccessRestricted(false);
      try {
        if (isTechnicianForCompany && userContext.userId) {
          const { data: assignments, error: assignmentError } = await supabase
            .from("project_assignments")
            .select("project_id")
            .eq("user_id", userContext.userId)
            .eq("is_active", true);
          if (assignmentError) throw assignmentError;

          const assignedProjectIds = ((assignments as { project_id: string }[]) || []).map((row) => row.project_id).filter(Boolean);
          if (assignedProjectIds.length === 0) {
            if (!cancelled) {
              setAccessRestricted(true);
              setForm(emptyCustomerForm());
            }
            return;
          }

          const { data: linkedProjects, error: linkedProjectError } = await supabase
            .from("projects")
            .select("id")
            .eq("company_id", companyId)
            .eq("customer_id", customerId)
            .in("id", assignedProjectIds)
            .limit(1);
          if (linkedProjectError) throw linkedProjectError;

          const hasAllowedLink = ((linkedProjects as { id: string }[]) || []).length > 0;
          if (!hasAllowedLink) {
            if (!cancelled) {
              setAccessRestricted(true);
              setForm(emptyCustomerForm());
            }
            return;
          }
        } else if (!isAdminForCompany) {
          if (!cancelled) {
            setAccessRestricted(true);
            setForm(emptyCustomerForm());
          }
          return;
        }

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
  }, [authLoading, companyId, customerId, isAdminForCompany, isTechnicianForCompany, userContext.userId]);

  const updateField = <K extends keyof CustomerFormState>(key: K, value: CustomerFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!isAdminForCompany && !isTechnicianForCompany) {
      setSaveError("Access restricted.");
      return;
    }
    if (isAdminForCompany) {
      const customerName = form.customer_name.trim();
      if (!customerName) {
        setSaveError("Customer name is required.");
        return;
      }
    }
    if (!companyId || !customerId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = isAdminForCompany
        ? toCustomerUpdatePayload(form)
        : {
            wifi_ssid: form.wifi_ssid.trim() || null,
            wifi_password: form.wifi_password.trim() || null,
          };
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
          <p className="mt-2 text-sm text-gray-600">
            {isTechnicianForCompany
              ? "Update Wi-Fi SSID and Wi-Fi password for this customer/site."
              : "Update customer and site details for this company."}
          </p>
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
          {!loading && accessRestricted ? (
            <p className="text-sm font-semibold text-amber-800">
              Access restricted. This customer/site is not linked to one of your assigned projects.
            </p>
          ) : null}
          {loadError ? <p className="text-sm font-semibold text-red-700">{loadError}</p> : null}
          {!loading && !loadError && !accessRestricted ? (
            <>
              <CustomerEditorForm
                form={form}
                onChange={updateField}
                showWifiPassword={showWifiPassword}
                onToggleWifiPassword={() => setShowWifiPassword((prev) => !prev)}
                editableFields={isTechnicianForCompany ? technicianEditableFields : undefined}
                visibleFields={isTechnicianForCompany ? technicianVisibleFields : undefined}
              />
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

