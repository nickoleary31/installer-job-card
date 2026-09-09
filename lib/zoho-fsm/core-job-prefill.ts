import type { CoreJobFields } from "../job-card-submission.ts";
import type { ZohoProjectInfoViewModel } from "./project-info.ts";

/**
 * Strips a recognized leading Zoho number prefix (WO, WO-, AP, AP- — case-insensitive, with
 * reasonable optional whitespace around the prefix and/or dash, e.g. "WO 7", "WO- 7", "WO - 7")
 * for presentation inside a Core Job Info field already labeled "Work Order #"/"Service
 * Appointment #" (which itself renders a fixed "WO-"/"SA-" prefix ahead of the input). Confirmed
 * against the live Zoho FSM test org that Service Appointment numbers use Zoho's own "AP-" prefix
 * (e.g. "AP-4"), not "SA-" — deliberately narrower than the app's general-purpose lib/format.ts
 * sanitizers (which only recognize "WO"/"SA" and are used for all manually-typed WO/SA fields
 * app-wide, untouched here).
 *
 * Conservative by construction: the prefix + separator is only stripped when it is immediately
 * followed by a digit (a plausible numeric Zoho identifier), via a zero-width lookahead rather
 * than consuming the digit itself. That lookahead cannot be satisfied by backtracking into a
 * word like "WORDSTART" or "APPLE" — after "WO"/"AP" the next character there is a letter, not
 * whitespace/dash/digit, so the whole match fails and the value is returned unchanged, trimmed
 * only. Never blindly strips a fixed character count.
 */
export function stripRecognizedZohoNumberPrefix(value: string | null | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const match = /^(WO|AP)\s*-?\s*(?=\d)/i.exec(trimmed);
  if (!match) return trimmed;
  return trimmed.slice(match[0].length).trim();
}

/**
 * Prefills Work Order # / Service Appointment # on a *new* job card from the project's Zoho
 * link, so card 2, 3, 4, etc. under the same Zoho-linked project never require re-entering
 * them. Fill-if-blank only, matching the existing project-autofill convention in app/page.tsx —
 * never overwrites a value the technician already typed. A no-op for unlinked (manually
 * created) projects, so their behavior is completely unaffected.
 *
 * Stores only the meaningful portion (e.g. "AP-4" -> "4") so the field's own fixed "WO-"/"SA-"
 * label prefix isn't doubled up. This only affects what gets prefilled into the editable
 * coreJob state — zoho_work_order_number/zoho_service_appointment_number in the database and
 * the "Linked to Zoho FSM" info panel are untouched and keep showing the exact Zoho identifiers.
 */
export function mergeZohoPrefillIntoCoreJob(
  current: CoreJobFields,
  info: ZohoProjectInfoViewModel,
): CoreJobFields {
  if (!info.linked) return current;

  const nextWorkOrder = current.workOrder.trim()
    ? current.workOrder
    : stripRecognizedZohoNumberPrefix(info.workOrderNumber);
  const nextServiceAppointment = current.serviceAppointment.trim()
    ? current.serviceAppointment
    : stripRecognizedZohoNumberPrefix(info.serviceAppointmentNumber);

  if (nextWorkOrder === current.workOrder && nextServiceAppointment === current.serviceAppointment) {
    return current;
  }
  return { ...current, workOrder: nextWorkOrder, serviceAppointment: nextServiceAppointment };
}
