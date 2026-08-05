/**
 * Demo-only completion-validation mode. Governs whether missing required fields/photos on
 * the Blaxtair full-job-card demo block "Complete Demo Submission" or merely warn.
 *
 * This is a prototype convenience switch so QA can repeatedly complete test job cards without
 * collecting every required photo, while still being able to demonstrate the strict, production-
 * intended behavior on demand. It must not become a technician-controlled bypass in production —
 * see docs/Blaxtair_Demo_Full_Job_Card.md's "Prototype-only vs. production" table. In production,
 * required-field/photo rules come from the applicable company/project/form configuration and are
 * enforced server-side, not toggled client-side.
 */

export type ValidationMode = "qa_relaxed" | "technician_strict";

export const DEFAULT_VALIDATION_MODE: ValidationMode = "qa_relaxed";

const STORAGE_KEY = "blaxtair-demo-validation-mode-v1";

export function loadValidationMode(): ValidationMode {
  if (typeof window === "undefined") return DEFAULT_VALIDATION_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "technician_strict" || raw === "qa_relaxed" ? raw : DEFAULT_VALIDATION_MODE;
  } catch {
    return DEFAULT_VALIDATION_MODE;
  }
}

export function saveValidationMode(mode: ValidationMode): { ok: true } | { ok: false; error: string } {
  if (typeof window === "undefined") return { ok: true };
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save validation mode." };
  }
}
