/**
 * Generic, domain-agnostic phone-number helpers. Shared so every part of the app that touches a
 * V1 `contact_number`-shaped phone value — manual entry (customer/site form) and the Zoho FSM
 * inbound mapping — displays it the same way, without either side owning its own copy of the
 * formatting logic.
 */

export const digitsOnly = (value: string) => value.replace(/\D/g, "");

/**
 * Formats a phone number as a live-typing input mask caps at 10 digits (US), building up
 * "(", "(xxx", "(xxx) xxx", "(xxx) xxx-xxxx" as digits accumulate. Also used non-interactively to
 * normalize an already-complete 10-digit value (e.g. "678-780-9723" -> "(678) 780-9723").
 */
export const formatPhoneNumber = (value: string) => {
  const digits = digitsOnly(value).slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};
