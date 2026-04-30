export type CustomerFormState = {
  customer_name: string;
  full_address: string;
  site_contact_name: string;
  contact_number: string;
  license_key_1: string;
  license_key_2: string;
  server_port_type: "" | "TLS" | "Proprietary";
  server_port_number: string;
  facility_code: string;
  wifi_ssid: string;
  wifi_password: string;
  notes: string;
};

export type CustomerRecord = {
  customer_name: string | null;
  full_address: string | null;
  site_contact_name: string | null;
  contact_number: string | null;
  license_key_1: string | null;
  license_key_2: string | null;
  server_port_type: "TLS" | "Proprietary" | null;
  server_port_number: string | null;
  facility_code: string | null;
  wifi_ssid: string | null;
  wifi_password: string | null;
  notes: string | null;
};

export const emptyCustomerForm = (): CustomerFormState => ({
  customer_name: "",
  full_address: "",
  site_contact_name: "",
  contact_number: "",
  license_key_1: "",
  license_key_2: "",
  server_port_type: "",
  server_port_number: "",
  facility_code: "",
  wifi_ssid: "",
  wifi_password: "",
  notes: "",
});

export const toFormState = (row: CustomerRecord): CustomerFormState => ({
  customer_name: row.customer_name?.trim() || "",
  full_address: row.full_address || "",
  site_contact_name: row.site_contact_name || "",
  contact_number: row.contact_number || "",
  license_key_1: row.license_key_1 || "",
  license_key_2: row.license_key_2 || "",
  server_port_type: row.server_port_type || "",
  server_port_number: row.server_port_number || "",
  facility_code: row.facility_code || "",
  wifi_ssid: row.wifi_ssid || "",
  wifi_password: row.wifi_password || "",
  notes: row.notes || "",
});

export const toCustomerUpdatePayload = (form: CustomerFormState) => ({
  customer_name: form.customer_name.trim(),
  full_address: form.full_address.trim() || null,
  site_contact_name: form.site_contact_name.trim() || null,
  contact_number: form.contact_number.trim() || null,
  license_key_1: form.license_key_1.trim() || null,
  license_key_2: form.license_key_2.trim() || null,
  server_port_type: form.server_port_type || null,
  server_port_number: form.server_port_number.trim() || null,
  facility_code: form.facility_code.trim() || null,
  wifi_ssid: form.wifi_ssid.trim() || null,
  wifi_password: form.wifi_password.trim() || null,
  notes: form.notes.trim() || null,
});

export const digitsOnly = (value: string) => value.replace(/\D/g, "");

export const formatPhoneNumber = (value: string) => {
  const digits = digitsOnly(value).slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export const formatLicenseKey = (value: string) => {
  const digits = digitsOnly(value).slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 1) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 1)}-${digits.slice(1)}`;
  if (digits.length <= 7) return `${digits.slice(0, 1)}-${digits.slice(1, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 1)}-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
};

export const isDuplicateCustomerNameError = (e: unknown) => {
  const maybeDbError = e as { code?: string; message?: string; details?: string } | null;
  const detailsText = `${maybeDbError?.message || ""} ${maybeDbError?.details || ""}`.toLowerCase();
  return (
    maybeDbError?.code === "23505" ||
    detailsText.includes("idx_customers_company_normalized_customer_name") ||
    detailsText.includes("duplicate key")
  );
};

