export function formatUpper(value: string | null | undefined) {
  if (!value) return "";
  return value.toUpperCase();
}

function stripFixedPrefix(value: string | null | undefined, prefix: string) {
  if (!value) return "";
  const rx = new RegExp(`^\\s*${prefix}-?\\s*`, "i");
  return value.replace(rx, "").trim();
}

export function sanitizeWorkOrderInput(value: string | null | undefined) {
  return stripFixedPrefix(value, "WO");
}

export function sanitizeServiceAppointmentInput(value: string | null | undefined) {
  return stripFixedPrefix(value, "SA");
}

export function formatWorkOrder(value: string | null | undefined) {
  const clean = sanitizeWorkOrderInput(value);
  return clean ? `WO-${clean}` : "";
}

export function formatServiceAppointment(value: string | null | undefined) {
  const clean = sanitizeServiceAppointmentInput(value);
  return clean ? `SA-${clean}` : "";
}

