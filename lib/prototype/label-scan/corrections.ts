/**
 * Suggest OCR confusion corrections — never auto-apply.
 * Pairs: I/1, E/6, O/0, S/5 (plus B/8, G/6 as secondary).
 */

import { luhnOk, onlyDigits, type LabelFieldKey } from "./profile.ts";

/** Primary pairs called out for AT3 technician review. */
export const PRIMARY_CONFUSABLE_PAIRS: Array<[string, string]> = [
  ["I", "1"],
  ["E", "6"],
  ["O", "0"],
  ["S", "5"],
];

export const CONFUSABLE_PAIRS: Array<[string, string]> = [
  ...PRIMARY_CONFUSABLE_PAIRS,
  ["B", "8"],
  ["G", "6"],
];

export type CorrectionSuggestion = {
  fieldKey: LabelFieldKey;
  from: string;
  to: string;
  reason: string;
  /** Suggested only — technician must accept explicitly */
  autoApply: false;
};

function swapChars(value: string, from: string, to: string): string {
  return value
    .split("")
    .map((ch) => {
      if (ch.toUpperCase() === from.toUpperCase()) {
        return ch === ch.toUpperCase() ? to.toUpperCase() : to.toLowerCase();
      }
      return ch;
    })
    .join("");
}

function hasPrimaryAmbiguity(value: string): boolean {
  const upper = value.toUpperCase();
  return PRIMARY_CONFUSABLE_PAIRS.some(([a, b]) => upper.includes(a) || upper.includes(b));
}

/** Generate alternate readings for ambiguous OCR tokens. Never mutates the proposed value. */
export function suggestCorrections(args: {
  fieldKey: LabelFieldKey;
  value: string;
  validationOk: boolean;
}): CorrectionSuggestion[] {
  const { fieldKey, value, validationOk } = args;
  if (!value.trim()) return [];
  const out: CorrectionSuggestion[] = [];
  const seen = new Set<string>();

  const push = (to: string, reason: string) => {
    const normalized = to.trim().toUpperCase();
    if (!normalized || normalized === value.trim().toUpperCase() || seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ fieldKey, from: value, to: normalized, reason, autoApply: false });
  };

  if (fieldKey === "imei" || fieldKey === "iccid") {
    let digitish = value.toUpperCase();
    for (const [letter, digit] of CONFUSABLE_PAIRS) {
      digitish = swapChars(digitish, letter, digit);
    }
    digitish = onlyDigits(digitish);
    if (fieldKey === "imei" && digitish.length === 15) {
      push(
        digitish,
        luhnOk(digitish)
          ? "Letter→digit substitution yields Luhn-valid IMEI (review before accept)"
          : "Letter→digit substitution yields 15 digits but Luhn still fails",
      );
    }
    if (fieldKey === "iccid" && digitish.length >= 19 && digitish.length <= 20) {
      push(digitish, "Letter→digit substitution for ICCID (review before accept)");
    }
  }

  if (fieldKey === "mac") {
    let hexish = value.toUpperCase().replace(/[^0-9A-F]/g, "");
    for (const [letter, digit] of CONFUSABLE_PAIRS) {
      hexish = swapChars(hexish, letter, digit);
    }
    hexish = hexish.replace(/[^0-9A-F]/g, "");
    if (hexish.length === 12) {
      push(hexish, "Ambiguous-char substitution for MAC (review before accept)");
    }
  }

  // AT3 activation / serial: always offer primary swaps when ambiguous glyphs present —
  // even if the raw token already "validates" (e.g. EEI-RVY vs EE1-RVY).
  if (fieldKey === "serial" || fieldKey === "activationCode") {
    if (!validationOk || hasPrimaryAmbiguity(value)) {
      for (const [letter, digit] of PRIMARY_CONFUSABLE_PAIRS) {
        if (value.toUpperCase().includes(letter)) {
          push(swapChars(value.toUpperCase(), letter, digit), `Possible ${letter}→${digit} OCR confusion`);
        }
        if (value.toUpperCase().includes(digit)) {
          push(swapChars(value.toUpperCase(), digit, letter), `Possible ${digit}→${letter} OCR confusion`);
        }
      }
      // Combined I→1 and E→6 (common AT3 activation miss)
      if (fieldKey === "activationCode") {
        let combined = value.toUpperCase();
        combined = swapChars(combined, "I", "1");
        combined = swapChars(combined, "E", "6");
        push(combined, "Combined I→1 and E→6 substitution (review before accept)");
        const iOnly = swapChars(value.toUpperCase(), "I", "1");
        push(iOnly, "Possible I→1 OCR confusion");
      }
      if (fieldKey === "serial") {
        let combined = value.toUpperCase();
        combined = swapChars(combined, "E", "6");
        combined = swapChars(combined, "I", "1");
        push(combined, "Combined E→6 / I→1 substitution (review before accept)");
      }
    }
  }

  return out.slice(0, 8);
}
