import { NextResponse } from "next/server";
import { extractBearerToken, getSupabaseServerEnv } from "@/lib/company-users/admin-api";
import { authorizeProjectAccess } from "@/lib/project-access";
import {
  buildExpenseReportPdf,
  type ExpenseReceiptAsset,
  type ExpenseReportCategoryTotal,
  type ExpenseReportLine,
} from "@/lib/expense-report-pdf";

export const maxDuration = 60;

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

function sanitizeFilenamePart(value: string): string {
  const cleaned = value.trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return cleaned || "Report";
}

function inferContentType(response: Response, url: string): "image/jpeg" | "image/png" | "application/pdf" | null {
  const header = (response.headers.get("content-type") || "").toLowerCase();
  if (header.includes("application/pdf")) return "application/pdf";
  if (header.includes("image/png")) return "image/png";
  if (header.includes("image/jpeg") || header.includes("image/jpg")) return "image/jpeg";
  const lower = url.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const companyId = typeof (body as { companyId?: unknown })?.companyId === "string" ? (body as { companyId: string }).companyId.trim() : "";
  const projectId = typeof (body as { projectId?: unknown })?.projectId === "string" ? (body as { projectId: string }).projectId.trim() : "";

  const env = getSupabaseServerEnv();
  const accessToken = extractBearerToken(req);
  const auth = await authorizeProjectAccess({ env, accessToken, companyId, projectId });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { dataClient } = auth;

  const [{ data: companyRow }, { data: projectRow }] = await Promise.all([
    dataClient.from("companies").select("name").eq("id", companyId).maybeSingle<{ name: string }>(),
    dataClient
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
  if (!projectRow) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const customerLookup = Array.isArray(projectRow.customers) ? projectRow.customers[0] : projectRow.customers;
  const customerName = customerLookup?.customer_name?.trim() || projectRow.customer_name?.trim() || "—";

  const { data: expenseRows, error: expensesError } = await dataClient
    .from("expenses")
    .select("id, amount, category, notes, created_by, created_at, receipt_url, lost_receipt")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (expensesError) {
    return NextResponse.json({ error: expensesError.message }, { status: 500 });
  }
  const expenses = (expenseRows as ExpenseRow[] | null) || [];

  const creatorIds = Array.from(new Set(expenses.map((e) => e.created_by).filter((v): v is string => Boolean(v))));
  const creatorLabels: Record<string, string> = {};
  if (creatorIds.length > 0) {
    const { data: userRows } = await dataClient.from("user_profiles").select("id, display_name, email").in("id", creatorIds);
    for (const row of (userRows as { id: string; display_name: string | null; email: string | null }[] | null) || []) {
      creatorLabels[row.id] = row.display_name?.trim() || row.email?.trim() || row.id;
    }
  }

  const categoryTotalsMap = new Map<string, number>();
  let grandTotal = 0;
  for (const expense of expenses) {
    const amount = typeof expense.amount === "number" ? expense.amount : Number(expense.amount || 0);
    if (!Number.isFinite(amount)) continue;
    const category = expense.category?.trim() || "Uncategorized";
    categoryTotalsMap.set(category, (categoryTotalsMap.get(category) || 0) + amount);
    grandTotal += amount;
  }
  const knownOrder = new Map<string, number>(EXPENSE_CATEGORIES.map((c, i) => [c, i]));
  const categoryTotals: ExpenseReportCategoryTotal[] = [...categoryTotalsMap.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => (knownOrder.get(a.category) ?? 999) - (knownOrder.get(b.category) ?? 999));

  const lines: ExpenseReportLine[] = expenses.map((expense) => {
    const amount = typeof expense.amount === "number" ? expense.amount : Number(expense.amount || 0);
    const date = expense.created_at ? new Date(expense.created_at).toLocaleDateString() : "—";
    const addedBy = expense.created_by ? creatorLabels[expense.created_by] || "Unknown user" : "Unknown user";
    const receiptStatus: ExpenseReportLine["receiptStatus"] = expense.receipt_url
      ? "Receipt attached"
      : expense.lost_receipt
        ? "Lost receipt"
        : "No receipt";
    return {
      amount: Number.isFinite(amount) ? amount : 0,
      category: expense.category?.trim() || "Uncategorized",
      date,
      addedBy,
      notes: expense.notes?.trim() || "",
      receiptStatus,
    };
  });

  // Download every receipt server-side (no CORS concern here, unlike a browser fetch) and
  // classify by content-type so images go in the photo grid and PDFs get appended as real pages.
  const receipts: ExpenseReceiptAsset[] = [];
  const receiptFetches = expenses.filter((e) => e.receipt_url);
  const receiptResults = await Promise.all(
    receiptFetches.map(async (expense) => {
      try {
        const response = await fetch(expense.receipt_url as string);
        if (!response.ok) return null;
        const contentType = inferContentType(response, expense.receipt_url as string);
        if (!contentType) return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const amount = typeof expense.amount === "number" ? expense.amount : Number(expense.amount || 0);
        const date = expense.created_at ? new Date(expense.created_at).toLocaleDateString() : "—";
        const amountLabel = Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
        const captionLabel = `$${amountLabel} — ${expense.category?.trim() || "Uncategorized"} — ${date}`;
        const asset: ExpenseReceiptAsset = { captionLabel, contentType, bytes };
        return asset;
      } catch {
        return null;
      }
    }),
  );
  for (const r of receiptResults) if (r) receipts.push(r);

  const pdfBytes = await buildExpenseReportPdf({
    header: {
      companyName: companyRow?.name?.trim() || "—",
      projectName: projectRow.project_name?.trim() || "—",
      customerName,
      generatedAt: new Date().toLocaleString(),
    },
    categoryTotals,
    grandTotal,
    lines,
    receipts,
  });

  const filename = `${sanitizeFilenamePart(companyRow?.name || "Company")}_${sanitizeFilenamePart(
    projectRow.project_name || "Project",
  )}_ExpenseReport.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
