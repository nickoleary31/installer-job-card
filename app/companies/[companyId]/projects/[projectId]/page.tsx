"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";

const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";
const PHOTO_BUCKET = "job-card-photos";
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

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

type ExpenseRow = {
  id: string;
  project_id: string;
  amount: number | string | null;
  category: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  receipt_url: string | null;
  lost_receipt: boolean | null;
  needs_review: boolean | null;
  review_reason: string | null;
  review_status: string | null;
};

type UserProfileLookupRow = {
  id: string;
  display_name: string | null;
  email: string | null;
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

const emptyProjectContext: ProjectContext = {
  companyName: "—",
  projectName: "—",
  customerName: "—",
  location: "—",
};

const displayCell = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);

const formatTimestamp = (value: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
};

const EXPENSE_CATEGORIES = [
  "Labor",
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

const getReceiptValidationError = (file: File | null) => {
  if (!file) return null;
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    return "Only JPEG and PNG receipt images are allowed.";
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return "Receipt image is too large (10MB max).";
  }
  return null;
};

export default function ProjectDashboardPage() {
  const params = useParams<{ companyId: string; projectId: string }>();
  const { loading: authLoading, context: userContext } = useAuthUserContext();
  const companyId = String(params.companyId || "");
  const projectId = String(params.projectId || "");
  const companyRole = userContext.companyRolesById[companyId];
  const isGlobalAdmin = userContext.globalRole === "admin";
  const [projectContext, setProjectContext] = useState<ProjectContext>(emptyProjectContext);
  const [siteInfoExpanded, setSiteInfoExpanded] = useState(false);
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [siteInfo, setSiteInfo] = useState<SiteInfo>(emptySiteInfo);
  const [hasLinkedCustomer, setHasLinkedCustomer] = useState(false);
  const [hasProjectAccess, setHasProjectAccess] = useState(false);
  const [accessResolved, setAccessResolved] = useState(false);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [expenseCreatorLabels, setExpenseCreatorLabels] = useState<Record<string, string>>({});
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [expensesError, setExpensesError] = useState<string | null>(null);
  const [savingExpense, setSavingExpense] = useState(false);
  const [saveExpenseError, setSaveExpenseError] = useState<string | null>(null);
  const [reviewToast, setReviewToast] = useState<string | null>(null);
  const [reviewActionExpenseId, setReviewActionExpenseId] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [lostReceiptInput, setLostReceiptInput] = useState(false);
  const [receiptValidationError, setReceiptValidationError] = useState<string | null>(null);
  const takePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const uploadReceiptInputRef = useRef<HTMLInputElement | null>(null);
  const receiptPreviewUrl = useMemo(() => (receiptFile ? URL.createObjectURL(receiptFile) : null), [receiptFile]);

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
    const loadPageData = async () => {
      if (!companyId || !projectId) return;
      if (authLoading) return;
      if (!userContext.userId) {
        if (!cancelled) {
          setHasProjectAccess(false);
          setAccessResolved(true);
          setProjectContext(emptyProjectContext);
          setHasLinkedCustomer(false);
          setSiteInfo(emptySiteInfo);
          setShowWifiPassword(false);
          setProjectLoadError(null);
        }
        return;
      }

      setAccessResolved(false);
      setProjectLoadError(null);

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
            setHasProjectAccess(false);
            setAccessResolved(true);
            setProjectContext(emptyProjectContext);
            setHasLinkedCustomer(false);
            setSiteInfo(emptySiteInfo);
            setShowWifiPassword(false);
            setExpenses([]);
            setExpenseCreatorLabels({});
          }
          return;
        }

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
        if (companyError) throw companyError;
        if (projectError) throw projectError;
        if (cancelled) return;

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
        setHasProjectAccess(true);
      } catch (error) {
        if (!cancelled) {
          setProjectLoadError(error instanceof Error ? error.message : "Failed to load project.");
          setHasProjectAccess(false);
          setProjectContext(emptyProjectContext);
          setHasLinkedCustomer(false);
          setSiteInfo(emptySiteInfo);
        }
      } finally {
        if (!cancelled) setAccessResolved(true);
      }
    };

    void loadPageData();
    return () => {
      cancelled = true;
    };
  }, [authLoading, companyId, companyRole, isGlobalAdmin, projectId, userContext.userId]);

  useEffect(() => {
    let cancelled = false;
    const loadExpenses = async () => {
      if (!companyId || !projectId || !userContext.userId || !hasProjectAccess || !accessResolved) return;
      setExpensesLoading(true);
      setExpensesError(null);
      try {
        const { data, error } = await supabase
          .from("expenses")
          .select("id, project_id, amount, category, notes, created_by, created_at, receipt_url, lost_receipt, needs_review, review_reason, review_status")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });
        if (error) throw error;

        const expenseRows = ((data as ExpenseRow[] | null) || []).filter((row) => row.project_id === projectId);
        if (!cancelled) setExpenses(expenseRows);

        const creatorIds = Array.from(
          new Set(
            expenseRows
              .map((row) => row.created_by)
              .filter((value): value is string => Boolean(value)),
          ),
        );
        if (creatorIds.length === 0) {
          if (!cancelled) setExpenseCreatorLabels({});
          return;
        }

        const { data: userRows, error: userError } = await supabase
          .from("user_profiles")
          .select("id, display_name, email")
          .in("id", creatorIds);
        if (userError) throw userError;
        if (cancelled) return;

        const labels = (((userRows as UserProfileLookupRow[] | null) || [])).reduce<Record<string, string>>((acc, row) => {
          const display = row.display_name?.trim() || row.email?.trim() || row.id;
          acc[row.id] = display;
          return acc;
        }, {});
        setExpenseCreatorLabels(labels);
      } catch (error) {
        if (!cancelled) {
          setExpenses([]);
          setExpenseCreatorLabels({});
          setExpensesError(error instanceof Error ? error.message : "Failed to load expenses.");
        }
      } finally {
        if (!cancelled) setExpensesLoading(false);
      }
    };

    void loadExpenses();
    return () => {
      cancelled = true;
    };
  }, [accessResolved, companyId, hasProjectAccess, projectId, userContext.userId]);

  const expenseTotal = useMemo(
    () =>
      expenses.reduce((sum, row) => {
        const numericAmount = typeof row.amount === "number" ? row.amount : Number(row.amount || 0);
        return Number.isFinite(numericAmount) ? sum + numericAmount : sum;
      }, 0),
    [expenses],
  );

  const flaggedExpenseCount = useMemo(
    () => expenses.filter((row) => row.needs_review === true).length,
    [expenses],
  );
  const flaggedExpenses = useMemo(
    () => expenses.filter((row) => row.needs_review === true),
    [expenses],
  );
  const canReviewExpenses = isGlobalAdmin || companyRole === "admin";

  const handleReceiptFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setReceiptFile(file);
    const nextValidationError = getReceiptValidationError(file);
    setReceiptValidationError(nextValidationError);
    if (file && !nextValidationError) {
      setLostReceiptInput(false);
      setSaveExpenseError(null);
    }
  };

  useEffect(() => {
    return () => {
      if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    };
  }, [receiptPreviewUrl]);

  const resetExpenseForm = () => {
    setAmountInput("");
    setCategoryInput("");
    setNotesInput("");
    setReceiptFile(null);
    setLostReceiptInput(false);
    setReceiptValidationError(null);
    setSaveExpenseError(null);
    if (takePhotoInputRef.current) takePhotoInputRef.current.value = "";
    if (uploadReceiptInputRef.current) uploadReceiptInputRef.current.value = "";
  };

  const handleCreateExpense = async () => {
    if (!userContext.userId) {
      setSaveExpenseError("Sign in to add an expense.");
      return;
    }
    if (!hasProjectAccess) {
      setSaveExpenseError("You do not have access to add expenses for this project.");
      return;
    }

    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSaveExpenseError("Enter a valid expense amount greater than zero.");
      return;
    }

    const category = categoryInput.trim();
    if (!category) {
      setSaveExpenseError("Select an expense category.");
      return;
    }

    const receiptError = getReceiptValidationError(receiptFile);
    if (receiptError) {
      setReceiptValidationError(receiptError);
      setSaveExpenseError(receiptError);
      return;
    }

    const notes = notesInput.trim();
    if (!receiptFile && !lostReceiptInput) {
      setSaveExpenseError("Attach a receipt photo or mark this as a lost receipt.");
      return;
    }
    if (!receiptFile && lostReceiptInput && !notes) {
      setSaveExpenseError("Add a note when marking an expense as a lost receipt.");
      return;
    }

    let uploadedReceiptUrl: string | null = null;

    setSavingExpense(true);
    setSaveExpenseError(null);
    try {
      const createdBy = userContext.userId;
      const expenseInsertPayload = {
        project_id: projectId,
        amount,
        category,
        notes: notes || null,
        created_by: createdBy,
        receipt_url: null,
        lost_receipt: !receiptFile && lostReceiptInput,
        needs_review: !receiptFile && lostReceiptInput,
        review_reason: !receiptFile && lostReceiptInput ? "Lost receipt" : null,
      };

      const { data: sessionData } = await supabase.auth.getSession();
      console.log("Expense insert auth debug", {
        hasSession: Boolean(sessionData.session),
        userId: sessionData.session?.user?.id,
        createdBy,
        projectId,
      });

      const { data: insertedExpense, error: insertError } = await supabase
        .from("expenses")
        .insert(expenseInsertPayload)
        .select("id, project_id, amount, category, notes, created_by, created_at, receipt_url, lost_receipt, needs_review, review_reason, review_status")
        .single<ExpenseRow>();
      if (insertError) {
        console.error("Expense insert failed", {
          message: insertError?.message,
          details: insertError?.details,
          hint: insertError?.hint,
          code: insertError?.code,
          raw: insertError,
          payload: expenseInsertPayload,
        });
        throw insertError;
      }

      let nextExpense = insertedExpense;
      if (receiptFile) {
        try {
          const safeName = receiptFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const objectPath = `expenses/${projectId}/${insertedExpense.id}/${Date.now()}-${safeName}`;
          const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(objectPath, receiptFile, {
            upsert: true,
            contentType: receiptFile.type || undefined,
          });
          if (uploadError) throw uploadError;
          const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(objectPath);
          uploadedReceiptUrl = data?.publicUrl || null;
          if (uploadedReceiptUrl) {
            const { data: updatedExpense, error: updateError } = await supabase
              .from("expenses")
              .update({ receipt_url: uploadedReceiptUrl })
              .eq("id", insertedExpense.id)
              .select("id, project_id, amount, category, notes, created_by, created_at, receipt_url, lost_receipt, needs_review, review_reason, review_status")
              .single<ExpenseRow>();
            if (updateError) throw updateError;
            nextExpense = updatedExpense;
          }
        } catch (uploadError) {
          console.error("Expense receipt upload failed:", uploadError);
          setSaveExpenseError("Receipt upload failed, expense saved without receipt");
        }
      }

      setExpenses((prev) => [nextExpense, ...prev]);
      setExpenseCreatorLabels((prev) => ({
        ...prev,
        [userContext.userId!]: "You",
      }));
      resetExpenseForm();
    } catch (error) {
      setSaveExpenseError(error instanceof Error ? error.message : "Failed to save expense.");
    } finally {
      setSavingExpense(false);
    }
  };

  const handleReviewAction = async (expenseId: string, action: "approved" | "rejected") => {
    if (!userContext.userId) return;
    if (!canReviewExpenses) return;
    setReviewActionExpenseId(expenseId);
    try {
      const nowIso = new Date().toISOString();
      const { data: updatedExpense, error } = await supabase
        .from("expenses")
        .update({
          review_status: action,
          reviewed_by: userContext.userId,
          reviewed_at: nowIso,
          needs_review: false,
        })
        .eq("id", expenseId)
        .eq("project_id", projectId)
        .select("id, project_id, amount, category, notes, created_by, created_at, receipt_url, lost_receipt, needs_review, review_reason, review_status")
        .single<ExpenseRow>();
      if (error) throw error;
      setExpenses((prev) => prev.map((expense) => (expense.id === expenseId ? updatedExpense : expense)));
      setReviewToast(action === "approved" ? "Expense approved" : "Expense rejected");
    } catch (error) {
      setSaveExpenseError(error instanceof Error ? error.message : "Failed to update expense review status.");
    } finally {
      setReviewActionExpenseId(null);
    }
  };

  useEffect(() => {
    if (!reviewToast) return;
    const timeoutId = window.setTimeout(() => setReviewToast(null), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [reviewToast]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-5 sm:py-2">
        <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <Image src="/powerfleet-logo.png" alt="Powerfleet" width={160} height={48} priority className="h-10 w-auto sm:h-12" />
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
            <p className="mt-2 text-gray-600">Log in to view this project and its expenses.</p>
            <Link href="/login" className="mt-4 inline-flex text-sm font-semibold text-blue-700 hover:underline">
              Go to login
            </Link>
          </section>
        ) : null}

        {!authLoading && userContext.userId && !accessResolved ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            Loading project…
          </section>
        ) : null}

        {projectLoadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            Could not load project: {projectLoadError}
          </section>
        ) : null}

        {!authLoading && userContext.userId && accessResolved && !hasProjectAccess && !projectLoadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
            Only global admins, active company admins, or technicians assigned to this project can view expenses here.
          </section>
        ) : null}

        {!authLoading && userContext.userId && accessResolved && hasProjectAccess ? (
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

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Project Expenses</h2>
                  <p className="mt-1 text-sm text-gray-600">Log simple project costs and optionally attach a receipt image.</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Total</p>
                  <p className="text-lg font-bold text-emerald-900">{formatCurrency(expenseTotal)}</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-800">Needs review: {flaggedExpenseCount}</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Amount</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amountInput}
                    onChange={(event) => {
                      setAmountInput(event.target.value);
                      setSaveExpenseError(null);
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-base text-gray-900"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Category</label>
                  <select
                    value={categoryInput}
                    onChange={(event) => {
                      setCategoryInput(event.target.value);
                      setSaveExpenseError(null);
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-base text-gray-900"
                  >
                    <option value="">Select category</option>
                    {EXPENSE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Notes</label>
                  <textarea
                    value={notesInput}
                    onChange={(event) => {
                      setNotesInput(event.target.value);
                      setSaveExpenseError(null);
                    }}
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-base text-gray-900"
                    placeholder={lostReceiptInput && !receiptFile ? "Required when receipt is lost" : "Optional details"}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Receipt photo (optional)</label>
                  <input
                    ref={takePhotoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleReceiptFileChange}
                    className="hidden"
                  />
                  <input
                    ref={uploadReceiptInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={handleReceiptFileChange}
                    className="hidden"
                  />
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => takePhotoInputRef.current?.click()}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      Take Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => uploadReceiptInputRef.current?.click()}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Upload Receipt
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">JPEG or PNG, up to 10MB.</p>
                  {receiptFile ? <p className="mt-1 text-xs text-gray-600">Selected: {receiptFile.name}</p> : null}
                  {receiptPreviewUrl ? (
                    <div className="mt-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={receiptPreviewUrl}
                        alt="Receipt preview"
                        className="h-24 w-24 rounded-lg border border-gray-200 object-cover"
                      />
                    </div>
                  ) : null}
                  {receiptValidationError ? <p className="mt-1 text-xs font-semibold text-amber-700">{receiptValidationError}</p> : null}
                  {!receiptFile ? (
                    <label className="mt-3 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={lostReceiptInput}
                        onChange={(event) => {
                          setLostReceiptInput(event.target.checked);
                          setSaveExpenseError(null);
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300"
                      />
                      <span>
                        Mark as lost receipt
                        <span className="block text-xs text-gray-500">
                          Lost receipts are flagged for admin review and require notes.
                        </span>
                      </span>
                    </label>
                  ) : (
                    <p className="mt-2 text-xs text-gray-500">Receipt selected. Lost receipt flag is not needed.</p>
                  )}
                </div>
              </div>

              {saveExpenseError ? <p className="mt-3 text-sm font-semibold text-amber-700">{saveExpenseError}</p> : null}
              {reviewToast ? <p className="mt-3 text-sm font-semibold text-emerald-700">{reviewToast}</p> : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCreateExpense}
                  disabled={savingExpense}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-5 py-3 text-base font-semibold text-blue-600 shadow-sm hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingExpense ? "Saving..." : "Add Expense"}
                </button>
                <button
                  type="button"
                  onClick={resetExpenseForm}
                  disabled={savingExpense}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-3 text-base font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear
                </button>
              </div>

              <div className="mt-6 space-y-3">
                {expensesLoading ? <p className="text-sm text-gray-600">Loading expenses…</p> : null}
                {expensesError ? <p className="text-sm font-semibold text-amber-700">Could not load expenses: {expensesError}</p> : null}
                {!expensesLoading && !expensesError && expenses.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                    No expenses logged for this project yet.
                  </p>
                ) : null}
                {!expensesLoading && !expensesError
                  ? expenses.map((expense) => {
                      const creatorLabel =
                        expense.created_by === userContext.userId
                          ? "You"
                          : expense.created_by
                            ? expenseCreatorLabels[expense.created_by] || "Unknown user"
                            : "Unknown user";
                      const amountValue =
                        typeof expense.amount === "number" ? expense.amount : Number(expense.amount || 0);
                      return (
                        <article
                          key={expense.id}
                          className="rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-base font-bold text-gray-900">
                                {Number.isFinite(amountValue) ? formatCurrency(amountValue) : "—"}
                              </p>
                              <p className="text-sm font-semibold text-gray-700">{displayCell(expense.category)}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                {expense.receipt_url ? (
                                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                    Receipt attached
                                  </span>
                                ) : null}
                                {expense.lost_receipt ? (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                    Lost receipt
                                  </span>
                                ) : null}
                                {expense.needs_review ? (
                                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                                    Needs review
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="text-right text-xs text-gray-500">
                              <p>{formatTimestamp(expense.created_at)}</p>
                              <p className="mt-1">Added by {creatorLabel}</p>
                            </div>
                          </div>
                          {expense.needs_review && expense.review_reason ? (
                            <p className="mt-2 text-xs font-semibold text-rose-700">Review reason: {expense.review_reason}</p>
                          ) : null}
                          {expense.notes?.trim() ? (
                            <p className="mt-3 text-sm text-gray-700">
                              {expense.notes.trim().length > 140
                                ? `${expense.notes.trim().slice(0, 140)}...`
                                : expense.notes.trim()}
                            </p>
                          ) : null}
                          {expense.receipt_url ? (
                            <a
                              href={expense.receipt_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex text-sm font-semibold text-blue-700 hover:underline"
                            >
                              View receipt
                            </a>
                          ) : null}
                        </article>
                      );
                    })
                  : null}
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
              <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Flagged Expenses</h2>
              <p className="mt-1 text-sm text-gray-600">Expenses that need admin review.</p>
              <div className="mt-4 space-y-3">
                {flaggedExpenses.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                    No flagged expenses for this project.
                  </p>
                ) : null}
                {flaggedExpenses.map((expense) => {
                  const amountValue = typeof expense.amount === "number" ? expense.amount : Number(expense.amount || 0);
                  return (
                    <article key={expense.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-bold text-gray-900">
                            {Number.isFinite(amountValue) ? formatCurrency(amountValue) : "—"}
                          </p>
                          <p className="text-sm font-semibold text-gray-700">{displayCell(expense.category)}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                              Needs Review
                            </span>
                            {expense.receipt_url ? (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                Receipt attached
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <p className="text-xs text-gray-500">{formatTimestamp(expense.created_at)}</p>
                      </div>
                      {expense.review_reason ? (
                        <p className="mt-2 text-xs font-semibold text-rose-700">Reason: {expense.review_reason}</p>
                      ) : null}
                      {expense.notes?.trim() ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{expense.notes.trim()}</p>
                      ) : null}
                      {canReviewExpenses ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleReviewAction(expense.id, "approved")}
                            disabled={reviewActionExpenseId === expense.id}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReviewAction(expense.id, "rejected")}
                            disabled={reviewActionExpenseId === expense.id}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
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

