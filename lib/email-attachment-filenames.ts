/**
 * Outbound email attachment filenames (does not rename Storage objects).
 */

export type AttachmentFilenameContext = {
  customer: string;
  assetNumber: string;
  productLabel?: string;
};

export function sanitizeFilenamePart(value: string, maxLen = 40): string {
  const cleaned = value
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!cleaned) return "Photo";
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/** Friendly label → filename segment, e.g. "Vehicle front" → "Vehicle_Front". */
export function labelToFilenameSegment(label: string): string {
  return sanitizeFilenamePart(label.replace(/\s+/g, " "), 48);
}

/**
 * Build attachment filename: Customer_Asset_Field[_2].jpg
 * sequenceInField is 1-based; omitted when 1.
 */
export function buildEmailAttachmentFilename(args: {
  customer: string;
  assetNumber: string;
  fieldLabel: string;
  sequenceInField?: number;
  extension?: string;
}): string {
  const customer = sanitizeFilenamePart(args.customer, 32);
  const asset = sanitizeFilenamePart(args.assetNumber, 24);
  const field = labelToFilenameSegment(args.fieldLabel);
  const seq = args.sequenceInField && args.sequenceInField > 1 ? `_${args.sequenceInField}` : "";
  const ext = (args.extension || "jpg").replace(/^\./, "").toLowerCase();
  const base = [customer, asset, field].filter(Boolean).join("_");
  const name = `${base}${seq}.${ext}`;
  return name.length > 120 ? `${name.slice(0, 116)}.${ext}` : name;
}
