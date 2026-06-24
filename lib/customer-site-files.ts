import { supabase } from "@/lib/supabase/client";

export type CustomerSiteFileRow = {
  id: string;
  company_id: string;
  customer_id: string | null;
  project_id: string;
  submission_id: string | null;
  file_type: string;
  file_name: string;
  storage_path: string;
  make: string | null;
  model: string | null;
  unit_number: string | null;
  notes: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

/**
 * List PPD JSON files for a project (site repository foundation).
 * Use for future customer/site pages: "all PPD JSON for this project".
 */
export async function listPpdJsonFilesByProjectId(projectId: string): Promise<CustomerSiteFileRow[]> {
  const { data, error } = await supabase
    .from("customer_site_files")
    .select("*")
    .eq("project_id", projectId)
    .eq("file_type", "ppd_json")
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data as CustomerSiteFileRow[]) || [];
}

/**
 * List PPD JSON files for a customer (site) across projects under that customer record.
 * customer_id may be null on older rows — callers typically filter project_id instead.
 */
export async function listPpdJsonFilesByCustomerId(customerId: string): Promise<CustomerSiteFileRow[]> {
  const { data, error } = await supabase
    .from("customer_site_files")
    .select("*")
    .eq("customer_id", customerId)
    .eq("file_type", "ppd_json")
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data as CustomerSiteFileRow[]) || [];
}

/** Resolve public URL for a stored object path in the customer-site-files bucket. */
export function publicUrlForCustomerSitePath(storagePath: string): string {
  const { data } = supabase.storage.from("customer-site-files").getPublicUrl(storagePath);
  return data?.publicUrl || "";
}
