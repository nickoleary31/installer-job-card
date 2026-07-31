/**
 * Validate product files and required uploads per product.
 */

import type { ProductFileDefinition, ProductFileUploadSlot, UploadedProductFile } from "./types.ts";
import { activeProductFileDefinitions } from "./definitions.ts";
import { productFileSlotId } from "./types.ts";

export type ProductFileValidationIssue = {
  productKey: string;
  fileKey: string;
  code: string;
  message: string;
};

function extensionOf(fileName: string): string {
  const name = fileName.trim().toLowerCase();
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i);
}

export function validateProductFile(
  file: File,
  def: ProductFileDefinition,
): { ok: true } | { ok: false; message: string } {
  const ext = extensionOf(file.name);
  if (def.acceptedExtensions.length > 0 && !def.acceptedExtensions.includes(ext)) {
    return {
      ok: false,
      message: `Only ${def.acceptedExtensions.join(", ")} files are allowed for ${def.label}.`,
    };
  }
  const mime = (file.type || "").toLowerCase();
  if (def.acceptedMimeTypes.length > 0 && mime && !def.acceptedMimeTypes.includes(mime)) {
    // Some browsers leave type empty for .json — allow empty MIME when extension matched.
    if (mime) {
      return {
        ok: false,
        message: `Unexpected file type for ${def.label}.`,
      };
    }
  }
  if (def.maxFileSizeBytes != null && file.size > def.maxFileSizeBytes) {
    const mb = Math.round(def.maxFileSizeBytes / (1024 * 1024));
    return { ok: false, message: `File exceeds ${mb} MB limit for ${def.label}.` };
  }
  return { ok: true };
}

export function slotHasProductFile(slot: ProductFileUploadSlot | undefined): boolean {
  if (!slot) return false;
  return slot.localFiles.length > 0 || slot.uploaded.length > 0;
}

/**
 * Product-specific required checks. Product A's requirement is never satisfied by Product B's files.
 */
export function collectRequiredProductFileIssues(args: {
  products: ReadonlyArray<{
    productKey: string;
    productFileDefinitions: ProductFileDefinition[];
  }>;
  slots: Readonly<Record<string, ProductFileUploadSlot>>;
  isOffline?: boolean;
}): ProductFileValidationIssue[] {
  const issues: ProductFileValidationIssue[] = [];
  for (const product of args.products) {
    for (const def of activeProductFileDefinitions(product.productFileDefinitions)) {
      if (!def.required) continue;
      const id = productFileSlotId({
        productKey: product.productKey,
        fileKey: def.key,
      });
      const slot = args.slots[id];
      if (slotHasProductFile(slot)) continue;
      issues.push({
        productKey: product.productKey,
        fileKey: def.key,
        code: args.isOffline
          ? `product-file-${product.productKey}-${def.key}-offline`
          : `product-file-${product.productKey}-${def.key}`,
        message: args.isOffline
          ? `${def.label} is required for ${product.productKey} (saved with device draft while offline).`
          : `${def.label} is required for this product.`,
      });
    }
  }
  return issues;
}

export function flattenUploadedProductFiles(
  slots: Readonly<Record<string, ProductFileUploadSlot>>,
): UploadedProductFile[] {
  const out: UploadedProductFile[] = [];
  for (const slot of Object.values(slots)) {
    for (const u of slot.uploaded) out.push(u);
  }
  return out;
}
