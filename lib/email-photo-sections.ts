/**
 * Photo sections + HTML/text renderers shared by Email Preview and Resend.
 * Kept free of path-alias imports so Node unit tests can load this file directly.
 *
 * Preview mode may use app-accessible URLs (e.g. publicUrl today).
 * Outbound email mode uses cid: references only — never Storage public URLs or gallery links.
 */

export type EmailPhotoUploadLike = {
  fieldName: string;
  group: string;
  label: string;
  filename: string;
  storagePath: string;
  publicUrl: string;
};

export type EmailPhotoPayloadLike = {
  photoUploads?: EmailPhotoUploadLike[];
  selectedSections?: string[];
  hardwareSelection?: { primary?: string };
  formId?: string;
  submissionType?: string;
  linxup?: unknown;
};

export type EmailPhotoItem = {
  fieldName: string;
  label: string;
  filename: string;
  /** Outbound email attachment + caption filename (generated at send). */
  attachmentDisplayName?: string;
  storagePath: string;
  /** App-only thumbnail URL. Must never be written into outbound email HTML/text. */
  previewUrl: string;
  /** Populated after optimization for preview notes. */
  optimizedBytes?: number;
  originalBytes?: number;
};

export type EmailPhotoField = {
  fieldName: string;
  label: string;
  photos: EmailPhotoItem[];
};

export type EmailPhotoSection = {
  heading: string;
  fields: EmailPhotoField[];
};

export type PhotoHtmlRenderMode = "preview" | "cid";

const VEHICLE_PHOTO_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "vehicleFront", label: "Vehicle front" },
  { key: "vehicleSide", label: "Vehicle side" },
  { key: "vehicleRear", label: "Vehicle rear" },
];

const VAC4_PHOTO_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "vacMounting", label: "VAC4 mounting" },
  { key: "wirePath", label: "Wire path" },
  { key: "redWire", label: "Red (+) battery" },
  { key: "blackWire", label: "Black (−) battery" },
  { key: "blueWire", label: "Blue wire" },
  { key: "purpleWire", label: "Purple wire" },
  { key: "brownWire", label: "Brown wire" },
  { key: "relayAccess", label: "Relay access" },
  { key: "impactSensor", label: "Impact sensor" },
  { key: "sensorHubMounting", label: "Sensor hub mounting" },
  { key: "speedSense", label: "Speed sense" },
  { key: "loadSense", label: "Load sense" },
  { key: "gps", label: "GPS" },
  { key: "externalIndicator", label: "External indicator" },
];

function isLinxUpKey(value: string | undefined | null): boolean {
  return (value || "").startsWith("linxup_");
}

export function resolveEmailPhotoPreviewUrl(photo: EmailPhotoUploadLike): string {
  return (photo.publicUrl || "").trim();
}

function detectFormFlags(p: EmailPhotoPayloadLike) {
  const primary = p.hardwareSelection?.primary || "";
  const sectionSet = new Set(p.selectedSections ?? []);
  const includeLinxUp =
    !!p.linxup ||
    isLinxUpKey(primary) ||
    isLinxUpKey(p.formId) ||
    isLinxUpKey(p.submissionType) ||
    [...sectionSet].some((s) => isLinxUpKey(s));
  const includeVac4 = !includeLinxUp && sectionSet.has("VAC4");
  const includePpd = !includeLinxUp && sectionSet.has("PPD");
  const includeCp4 = !includeLinxUp && sectionSet.has("CP4");
  return { includeLinxUp, includeVac4, includePpd, includeCp4 };
}

function toPhotoItem(u: EmailPhotoUploadLike): EmailPhotoItem | null {
  const storagePath = (u.storagePath || "").trim();
  const previewUrl = resolveEmailPhotoPreviewUrl(u);
  const filename = (u.filename || "").trim();
  if (!storagePath && !previewUrl && !filename) return null;
  return {
    fieldName: u.fieldName,
    label: (u.label || "").trim() || u.fieldName,
    filename,
    storagePath,
    previewUrl,
  };
}

function fieldsFromUploads(
  uploads: EmailPhotoUploadLike[],
  orderedKeys?: ReadonlyArray<{ key: string; label: string }>,
): EmailPhotoField[] {
  const byField = new Map<string, EmailPhotoUploadLike[]>();
  for (const u of uploads) {
    const list = byField.get(u.fieldName) ?? [];
    list.push(u);
    byField.set(u.fieldName, list);
  }

  if (orderedKeys) {
    return orderedKeys.map(({ key, label }) => {
      const items = (byField.get(key) ?? []).map(toPhotoItem).filter((x): x is EmailPhotoItem => !!x);
      byField.delete(key);
      return {
        fieldName: key,
        label: items[0]?.label || label,
        photos: items,
      };
    });
  }

  return [...byField.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fieldName, rows]) => {
      const photos = rows.map(toPhotoItem).filter((x): x is EmailPhotoItem => !!x);
      return {
        fieldName,
        label: photos[0]?.label || rows[0]?.label?.trim() || fieldName,
        photos,
      };
    });
}

export function buildEmailPhotoSections(p: EmailPhotoPayloadLike): EmailPhotoSection[] {
  const uploads = Array.isArray(p.photoUploads) ? p.photoUploads : [];
  const { includeLinxUp, includeVac4, includePpd, includeCp4 } = detectFormFlags(p);
  const sections: EmailPhotoSection[] = [];

  const vehicleUploads = uploads.filter((u) => u.group === "vehicle");
  if (includeLinxUp || vehicleUploads.length > 0) {
    sections.push({
      heading: "Vehicle Pictures",
      fields: fieldsFromUploads(vehicleUploads, VEHICLE_PHOTO_FIELDS),
    });
  }

  if (includeLinxUp) {
    const linxupUploads = uploads.filter((u) => u.group === "linxup");
    if (linxupUploads.length > 0) {
      const product =
        (typeof p.linxup === "object" &&
          p.linxup &&
          "productLabel" in p.linxup &&
          typeof (p.linxup as { productLabel?: string }).productLabel === "string" &&
          (p.linxup as { productLabel?: string }).productLabel?.trim()) ||
        "LinxUp";
      sections.push({
        heading: `${product} Install Pictures`,
        fields: fieldsFromUploads(linxupUploads),
      });
    }
  }

  if (includeVac4) {
    const vacUploads = uploads.filter((u) => u.group === "vac4");
    sections.push({
      heading: "PHOTOS",
      fields: fieldsFromUploads(vacUploads, VAC4_PHOTO_FIELDS),
    });
  }

  if (includePpd) {
    sections.push({
      heading: "PPD PHOTOS",
      fields: fieldsFromUploads(uploads.filter((u) => u.group === "ppd")),
    });
  }

  if (includeCp4) {
    sections.push({
      heading: "CP4 PHOTOS",
      fields: fieldsFromUploads(uploads.filter((u) => u.group === "cp4")),
    });
  }

  return sections;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain-text photo listing: labels + filenames only (no URLs, no gallery link). */
export function renderPhotoSectionsText(sections: EmailPhotoSection[]): string {
  const lines: string[] = [];
  const divider = "--------------------------------";
  for (const section of sections) {
    if (lines.length > 0) {
      lines.push("");
      lines.push(divider);
      lines.push("");
    } else {
      lines.push(divider);
      lines.push("");
    }
    lines.push(section.heading);
    const withPhotos = section.fields.filter((f) => f.photos.length > 0);
    if (withPhotos.length === 0) {
      lines.push("None uploaded");
      continue;
    }
    for (const field of section.fields) {
      if (field.photos.length === 0) {
        lines.push(`${field.label}: None uploaded`);
        continue;
      }
      for (const photo of field.photos) {
        const caption = photo.attachmentDisplayName || photo.filename || "photo";
        lines.push(`${field.label}: ${caption}`);
      }
    }
  }
  return lines.join("\n");
}

export type RenderPhotoSectionsHtmlOptions = {
  mode: PhotoHtmlRenderMode;
  /** Required when mode === "cid". Maps storagePath → contentId (no cid: prefix). */
  cidByStoragePath?: Map<string, string> | Record<string, string>;
  /** True attachment failures only — never successful optimization notes. */
  attachmentFailures?: string[];
};

function resolveCid(map: RenderPhotoSectionsHtmlOptions["cidByStoragePath"], storagePath: string): string {
  if (!map) return "";
  if (map instanceof Map) return (map.get(storagePath) || "").trim();
  return (map[storagePath] || "").trim();
}

/**
 * HTML photo blocks.
 * - preview: <img src={previewUrl}> for in-app Email Preview
 * - cid: <img src="cid:..."> for outbound Resend HTML (never public Storage URLs)
 */
export function renderPhotoSectionsHtml(
  sections: EmailPhotoSection[],
  options: RenderPhotoSectionsHtmlOptions,
): string {
  const parts: string[] = [];
  parts.push(`<hr style="border:none;border-top:1px solid #d1d5db;margin:20px 0;" />`);
  parts.push(`<h2 style="margin:0 0 12px;font-size:16px;font-weight:700;">PHOTOS</h2>`);

  if (options.attachmentFailures && options.attachmentFailures.length > 0) {
    parts.push(`<div style="margin:0 0 16px;padding:10px 12px;border:1px solid #f59e0b;background:#fffbeb;border-radius:6px;">`);
    parts.push(`<p style="margin:0 0 6px;font-weight:700;color:#92400e;">Some photos failed to attach:</p>`);
    parts.push(`<ul style="margin:0;padding-left:18px;color:#92400e;">`);
    for (const failure of options.attachmentFailures) {
      parts.push(`<li style="margin:0 0 4px;">${escapeHtml(failure)}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  for (const section of sections) {
    parts.push(`<h3 style="margin:20px 0 12px;font-size:15px;font-weight:700;">${escapeHtml(section.heading)}</h3>`);
    const withPhotos = section.fields.filter((f) => f.photos.length > 0);
    if (withPhotos.length === 0) {
      parts.push(`<p style="margin:0 0 12px;color:#6b7280;">None uploaded</p>`);
      continue;
    }
    for (const field of section.fields) {
      if (field.photos.length === 0) continue;
      parts.push(`<div style="margin:0 0 18px;">`);
      parts.push(`<p style="margin:0 0 8px;font-weight:600;">${escapeHtml(field.label)}</p>`);
      for (const photo of field.photos) {
        parts.push(`<figure style="margin:0 0 12px;padding:0;">`);
        if (options.mode === "preview") {
          if (photo.previewUrl) {
            parts.push(
              `<img src="${escapeHtml(photo.previewUrl)}" alt="${escapeHtml(photo.label || photo.filename || "Photo")}" width="480" style="display:block;max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:6px;" />`,
            );
          } else {
            parts.push(
              `<p style="margin:0;color:#b91c1c;font-size:13px;">Preview unavailable${photo.filename ? ` (${escapeHtml(photo.filename)})` : ""}</p>`,
            );
          }
        } else {
          const contentId = photo.storagePath ? resolveCid(options.cidByStoragePath, photo.storagePath) : "";
          if (contentId) {
            parts.push(
              `<img src="cid:${escapeHtml(contentId)}" alt="${escapeHtml(photo.label || photo.filename || "Photo")}" width="480" style="display:block;max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:6px;" />`,
            );
          } else {
            parts.push(
              `<p style="margin:0;color:#b91c1c;font-size:13px;">Image could not be attached${photo.filename ? `: ${escapeHtml(photo.filename)}` : ""}</p>`,
            );
          }
        }
        if (photo.attachmentDisplayName || photo.filename) {
          const caption = photo.attachmentDisplayName || photo.filename;
          parts.push(
            `<figcaption style="margin-top:4px;font-size:12px;color:#4b5563;">${escapeHtml(caption)}</figcaption>`,
          );
        }
        parts.push(`</figure>`);
      }
      parts.push(`</div>`);
    }
  }
  return parts.join("");
}

export function applyEmailAttachmentFilenames(
  sections: EmailPhotoSection[],
  ctx: { customer: string; assetNumber: string },
  buildName: (args: {
    customer: string;
    assetNumber: string;
    fieldLabel: string;
    sequenceInField: number;
    extension?: string;
  }) => string,
): EmailPhotoSection[] {
  return sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      let seq = 0;
      return {
        ...field,
        photos: field.photos.map((photo) => {
          seq += 1;
          const attachmentDisplayName = buildName({
            customer: ctx.customer,
            assetNumber: ctx.assetNumber,
            fieldLabel: field.label || photo.label,
            sequenceInField: seq,
            extension: "jpg",
          });
          return { ...photo, attachmentDisplayName };
        }),
      };
    }),
  }));
}

export function renderEmailHtmlFromParts(model: {
  documentHtml: string;
}): string {
  return model.documentHtml;
}
