/**
 * Selectable base forms for admin product mapping (hardcoded implementations).
 */

import { FORM_DEFINITIONS, type FormDefinition } from "../form-registry.ts";

/** Registry forms that may be chosen as baseFormId (exclude Blaxtair aliases). */
export function listSelectableBaseForms(): FormDefinition[] {
  return FORM_DEFINITIONS.filter(
    (f) => f.active && !f.baseFormId && !f.id.startsWith("blaxtair_"),
  ).sort((a, b) => a.displayOrder - b.displayOrder);
}

export function getBaseFormDefinition(baseFormId: string | null | undefined): FormDefinition | undefined {
  if (!baseFormId) return undefined;
  const id = baseFormId.trim();
  const direct = FORM_DEFINITIONS.find((f) => f.id === id);
  if (direct && !direct.baseFormId) return direct;
  // Allow passing section keys like "PPD" / "Speed SSC" for convenience.
  return FORM_DEFINITIONS.find((f) => !f.baseFormId && (f.sectionKey === id || f.id === id));
}

export function isKnownBaseFormId(baseFormId: string | null | undefined): boolean {
  return !!getBaseFormDefinition(baseFormId);
}
