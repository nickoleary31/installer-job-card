"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";

const EXPENSE_CATEGORIES = [
  "Labor",
  "Travel - Airfare",
  "Travel - Fuel",
  "Travel - Car Rental",
  "Travel - Lodging",
  "Travel - Meals",
  "Parts / Hardware",
  "Shipping / Freight",
  "Tools",
  "Consumables",
  "Subcontractor",
  "Misc",
] as const;

type ExpenseRow = {
  id: string;
  amount: number | string | null;
  category: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  receipt_url: string | null;
  lost_receipt: boolean | null;
};

type ProjectContext = {
  companyName: string;
  projectName: string;
  customerName: string;
};

const emptyProjectContext: ProjectContext = { companyName: "—", projectName: "—", customerName: "—" };

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

const formatDate = (value: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
};

function isPdfReceipt(url: string): boolean {
  return url.toLowerCase().split("?")[0].endsWith(".pdf");
}

export default function ExpenseReportPage() {
  const params = useParams<{ companyId: string; projectId: string }>();
  const { loading: authLoading, context: userContext } = useAuthUserContext();
  const companyId = String(params.companyId || "");
  const projectId = String(params.projectId || "");
  const companyRole = userContext.companyRolesById[companyId];
  const isGlobalAdmin = userContext.globalRole === "admin";

  const [accessResolved, setAccessResolved] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [projectContext, setProjectContext] = useState<ProjectContext>(emptyProjectContext);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [creatorLabels, setCreatorLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (authLoading || !companyId || !projectId) return;
      if (!userContext.userId) {
        if (!cancelled) {
          setHasAccess(false);
          setAccessResolved(true);
        }
        return;
      }
      setAccessResolved(false);
      setLoadError(null);
      setLoading(true);
      try {
        let allowed = isGlobalAdmin || companyRole === "admin";
        if (!allowed && companyRole === "technician") {
          const { data: assignmentRows, error: assignmentError } = await supabase
            .from("project_assignments")
            .select("project_id")
            .eq("user_id", userContext.userId)
            .eq("project_id", projectId)
            .eq("is_active", true)
            .limit(1);
          if (assignmentError) throw assignmentError;
          allowed = ((assignmentRows as { project_id: string }[] | null) || []).length > 0;
        }
        if (!allowed) {
          if (!cancelled) {
            setHasAccess(false);
            setProjectContext(emptyProjectContext);
            setExpenses([]);
          }
          return;
        }

        const [{ data: companyRow }, { data: projectRow }] = await Promise.all([
          supabase.from("companies").select("name").eq("id", companyId).maybeSingle<{ name: string }>(),
          supabase
            .from("projects")
            .select("project_name, customer_id, customer_name, customers:customer_id(customer_name)")
            .eq("id", projectId)
            .eq("company_id", companyId)
            .maybeSingle<{
              project_name: string | null;
              customer_id: string | null;
              customer_name: string | null;
              customers: { customer_name: string | null } | { customer_name: string | null }[] | null;
            }>(),
        ]);
        if (cancelled) return;
        const customerLookup = Array.isArray(projectRow?.customers) ? projectRow?.customers[0] : projectRow?.customers;
        setProjectContext({
          companyName: companyRow?.name?.trim() || "—",
          projectName: projectRow?.project_name?.trim() || "—",
          customerName: customerLookup?.customer_name?.trim() || projectRow?.customer_name?.trim() || "—",
        });
        setHasAccess(true);

        const { data: expenseRows, error: expensesError } = await supabase
          .from("expenses")
          .select("id, amount, category, notes, created_by, created_at, receipt_url, lost_receipt")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });
        if (expensesError) throw expensesError;
        const rows = (expenseRows as ExpenseRow[] | null) || [];
        if (cancelled) return;
        setExpenses(rows);

        const creatorIds = Array.from(new Set(rows.map((r) => r.created_by).filter((v): v is string => Boolean(v))));
        if (creatorIds.length > 0) {
          const { data: userRows } = await supabase.from("user_profiles").select("id, display_name, email").in("id", creatorIds);
          if (cancelled) return;
          const labels: Record<string, string> = {};
          for (const row of (userRows as { id: string; display_name: string | null; email: string | null }[] | null) || []) {
            labels[row.id] = row.display_name?.trim() || row.email?.trim() || row.id;
          }
          setCreatorLabels(labels);
        }
      } catch (error) {
        if (!cancelled) {
          setHasAccess(false);
          setLoadError(error instanceof Error ? error.message : "Failed to load expense report.");
        }
      } finally {
        if (!cancelled) {
          setAccessResolved(true);
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, companyId, companyRole, isGlobalAdmin, projectId, userContext.userId]);

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const expense of expenses) {
      const amount = typeof expense.amount === "number" ? expense.amount : Number(expense.amount || 0);
      if (!Number.isFinite(amount)) continue;
      const category = expense.category?.trim() || "Uncategorized";
      map.set(category, (map.get(category) || 0) + amount);
    }
    const order = new Map(EXPENSE_CATEGORIES.map((c, i) => [c as string, i]));
    return [...map.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => (order.get(a.category) ?? 999) - (order.get(b.category) ?? 999));
  }, [expenses]);

  const grandTotal = useMemo(
    () => categoryTotals.reduce((sum, row) => sum + row.total, 0),
    [categoryTotals],
  );

  const receiptExpenses = useMemo(() => expenses.filter((e) => e.receipt_url || e.lost_receipt), [expenses]);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token?.trim() || "";
      if (!token) throw new Error("Sign in again to export.");
      const res = await fetch("/api/expense-report", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, projectId }),
      });
      if (!res.ok) {
        let message = `Export failed (${res.status})`;
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) message = json.error;
        } catch {
          /* ignore non-JSON error body */
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("content-disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      a.download = match?.[1] || "ExpenseReport.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  if (authLoading || (!accessResolved && userContext.userId)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-gray-600">Loading expense report…</p>
      </main>
    );
  }

  if (!userContext.userId) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-gray-600">Log in to view this project&apos;s expense report.</p>
        </div>
      </main>
    );
  }

  if (!hasAccess) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
          {loadError || "Only global admins, active company admins, or technicians assigned to this project can view this report."}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-16 pt-6 sm:px-5">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
          <Link
            href={`/companies/${companyId}/projects/${projectId}`}
            className="text-sm font-semibold text-blue-700 underline"
          >
            ← Back to project
          </Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-950">Expense Report</h1>
              <p className="mt-1 text-sm text-gray-600">
                {projectContext.projectName} · {projectContext.companyName} · {projectContext.customerName}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting}
              className="inline-flex min-h-[48px] items-center justify-center rounded-lg border-2 border-emerald-600 bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? "Exporting…" : "Export PDF"}
            </button>
          </div>
          {exportError ? <p className="mt-3 text-sm font-semibold text-amber-700">{exportError}</p> : null}
        </header>

        {loading ? <p className="text-sm text-gray-600">Loading…</p> : null}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Totals by Category</h2>
          <div className="mt-4 space-y-2">
            {categoryTotals.length === 0 ? (
              <p className="text-sm text-gray-600">No expenses logged for this project yet.</p>
            ) : (
              categoryTotals.map((row) => (
                <div key={row.category} className="flex items-center justify-between border-b border-gray-100 py-2 text-sm">
                  <span className="font-medium text-gray-800">{row.category}</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(row.total)}</span>
                </div>
              ))
            )}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <span className="text-sm font-bold uppercase tracking-wide text-emerald-800">Grand Total</span>
            <span className="text-lg font-bold text-emerald-900">{formatCurrency(grandTotal)}</span>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Expenses</h2>
          <div className="mt-4 space-y-3">
            {expenses.length === 0 ? (
              <p className="text-sm text-gray-600">No expenses logged for this project yet.</p>
            ) : (
              expenses.map((expense) => {
                const amountValue = typeof expense.amount === "number" ? expense.amount : Number(expense.amount || 0);
                const addedBy = expense.created_by ? creatorLabels[expense.created_by] || "Unknown user" : "Unknown user";
                return (
                  <article key={expense.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-bold text-gray-900">
                          {Number.isFinite(amountValue) ? formatCurrency(amountValue) : "—"}
                        </p>
                        <p className="text-sm font-semibold text-gray-700">{expense.category?.trim() || "Uncategorized"}</p>
                      </div>
                      <div className="text-right text-xs text-gray-500">
                        <p>{formatDate(expense.created_at)}</p>
                        <p className="mt-1">Added by {addedBy}</p>
                      </div>
                    </div>
                    {expense.notes?.trim() ? <p className="mt-2 text-sm text-gray-700">{expense.notes.trim()}</p> : null}
                    <p className="mt-2 text-xs font-semibold text-gray-500">
                      {expense.receipt_url ? "Receipt attached" : expense.lost_receipt ? "Lost receipt" : "No receipt"}
                    </p>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Receipts</h2>
          {receiptExpenses.length === 0 ? (
            <p className="mt-3 text-sm text-gray-600">No receipts attached.</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {receiptExpenses.map((expense) => {
                const url = expense.receipt_url;
                const amountValue = typeof expense.amount === "number" ? expense.amount : Number(expense.amount || 0);
                const caption = `${Number.isFinite(amountValue) ? formatCurrency(amountValue) : "—"} — ${expense.category?.trim() || "Uncategorized"}`;
                if (!url) {
                  return (
                    <div key={expense.id} className="block overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/expense-report/missing-receipt.png" alt="Missing receipt" className="h-28 w-full object-cover" />
                      <p className="truncate px-2 py-2 text-xs font-medium text-gray-700">{caption}</p>
                    </div>
                  );
                }
                return (
                  <a
                    key={expense.id}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                  >
                    {isPdfReceipt(url) ? (
                      <div className="flex h-28 w-full items-center justify-center bg-gray-100 text-xs font-semibold text-gray-600">
                        PDF receipt
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={caption} className="h-28 w-full object-cover" />
                    )}
                    <p className="truncate px-2 py-2 text-xs font-medium text-gray-700 group-hover:underline">{caption}</p>
                  </a>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
