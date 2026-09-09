import { sanitizeServiceAppointmentInput, sanitizeWorkOrderInput } from "../format.ts";
import type { CoreJobFields } from "../job-card-submission.ts";
import type { ZohoProjectInfoViewModel } from "./project-info.ts";

/**
 * Prefills Work Order # / Service Appointment # on a *new* job card from the project's Zoho
 * link, so card 2, 3, 4, etc. under the same Zoho-linked project never require re-entering
 * them. Fill-if-blank only, matching the existing project-autofill convention in app/page.tsx —
 * never overwrites a value the technician already typed. A no-op for unlinked (manually
 * created) projects, so their behavior is completely unaffected.
 */
export function mergeZohoPrefillIntoCoreJob(
  current: CoreJobFields,
  info: ZohoProjectInfoViewModel,
): CoreJobFields {
  if (!info.linked) return current;

  const nextWorkOrder = current.workOrder.trim()
    ? current.workOrder
    : sanitizeWorkOrderInput(info.workOrderNumber || "");
  const nextServiceAppointment = current.serviceAppointment.trim()
    ? current.serviceAppointment
    : sanitizeServiceAppointmentInput(info.serviceAppointmentNumber || "");

  if (nextWorkOrder === current.workOrder && nextServiceAppointment === current.serviceAppointment) {
    return current;
  }
  return { ...current, workOrder: nextWorkOrder, serviceAppointment: nextServiceAppointment };
}
