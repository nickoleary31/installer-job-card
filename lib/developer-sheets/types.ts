/**
 * Row shapes for the Developer Sheets domain (developer_sheet_cards /
 * developer_sheet_documentation_entries / developer_sheet_documentation_photos). Mirrors the
 * schema in supabase/migrations/20260915000000_developer_sheets_phase1_foundation.sql exactly.
 */

export type DeveloperSheetCard = {
  id: string;
  company_id: string;
  project_id: string;
  product_name: string;
  product_scope: string | null;
  product_part_numbers: string[];
  additional_notes: string | null;
  developer_summary: string | null;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DeveloperSheetDocumentationEntry = {
  id: string;
  card_id: string;
  company_id: string;
  project_id: string;
  title: string | null;
  notes: string | null;
  part_number: string | null;
  tag: string | null;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DeveloperSheetDocumentationPhoto = {
  id: string;
  entry_id: string;
  company_id: string;
  project_id: string;
  storage_path: string;
  file_name: string | null;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

/** Whether the current viewer may see/use archive-or-restore controls (backend-enforced too). */
export function canArchiveDeveloperSheets(args: { isGlobalAdmin: boolean; companyRole: "admin" | "technician" | undefined }): boolean {
  return args.isGlobalAdmin || args.companyRole === "admin";
}

/** Parse a comma/newline-separated part-number input into the text[] the schema expects. */
export function parsePartNumbersInput(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export function formatPartNumbersForInput(values: string[] | null | undefined): string {
  return (values || []).join(", ");
}
