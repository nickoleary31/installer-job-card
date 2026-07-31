/**
 * Adapt hardcoded registry assignments into NormalizedProductDefinition[].
 */

import {
  FORM_DEFINITIONS,
  getAllowedAdditionalSectionKeys,
  getAllowedPrimaryForms,
  getFormsForCompanyName,
  type FormDefinition,
} from "../form-registry.ts";
import { resolveProductFileDefinitionsForProduct } from "../product-files/definitions.ts";
import type { NormalizedProductDefinition } from "./types.ts";

function toNormalizedFromRegistryForm(
  form: FormDefinition,
  companyName: string,
): NormalizedProductDefinition {
  const assigned = getFormsForCompanyName(companyName);
  const assignedKeys = assigned.map((f) => f.sectionKey);
  const primaryForms = getAllowedPrimaryForms(companyName);
  const allowPrimary = primaryForms.some((f) => f.sectionKey === form.sectionKey);

  let allowAdditional = false;
  for (const primary of primaryForms) {
    if (getAllowedAdditionalSectionKeys(companyName, primary.sectionKey).includes(form.sectionKey)) {
      allowAdditional = true;
      break;
    }
  }
  if (!allowPrimary && assignedKeys.includes(form.sectionKey)) {
    allowAdditional = true;
  }

  let allowedAdditionalProductKeys: string[] | null = null;
  let maxAdditionalCount: number | null = null;
  if (allowPrimary) {
    const allowed = getAllowedAdditionalSectionKeys(companyName, form.sectionKey);
    const peers = assignedKeys.filter((k) => k !== form.sectionKey);
    const unrestricted =
      allowed.length === peers.length && peers.every((k) => allowed.includes(k));
    if (!unrestricted) {
      allowedAdditionalProductKeys = [...allowed];
      maxAdditionalCount = 1;
    }
  }

  const baseFormId = form.baseFormId || form.id;
  // Exact shared PPD form (id "ppd" / productKey "PPD") gets the shared JSON default via
  // resolveProductFileDefinitionsForProduct — never via baseFormId inheritance for aliases.
  return {
    productKey: form.sectionKey,
    displayLabel: form.label,
    baseFormId,
    sectionKey: form.sectionKey,
    submissionType: form.submissionType,
    draftKey: form.draftKey,
    profileId: form.profileId,
    allowPrimary,
    allowAdditional,
    active: form.active,
    displayOrder: form.displayOrder,
    allowedAdditionalProductKeys,
    maxAdditionalCount,
    productFileDefinitions: resolveProductFileDefinitionsForProduct({
      baseFormId,
      productKey: form.sectionKey,
      sectionKey: form.sectionKey,
      formId: form.id,
    }),
    source: "registry",
  };
}

export function resolveCompanyProductsFromRegistry(
  companyName: string | null | undefined,
): NormalizedProductDefinition[] {
  const name = companyName || "";
  return getFormsForCompanyName(name).map((form) => toNormalizedFromRegistryForm(form, name));
}

export function listAllRegistryBaseImplementations(): FormDefinition[] {
  return FORM_DEFINITIONS.filter((f) => !f.baseFormId);
}
