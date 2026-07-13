/**
 * Mobile-friendly HTML email layout (cards + label/value tables).
 */

import type { EmailLayoutDocument } from "./email-layout-model";
import { renderLayoutDocumentPlainText } from "./email-layout-model";
import type { EmailPhotoSection } from "./email-photo-sections";
import { renderPhotoSectionsHtml, type PhotoHtmlRenderMode } from "./email-photo-sections";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightNotInstalled(value: string): string {
  if (value === "Not Installed") {
    return `<span style="color:#b91c1c;font-weight:700;">Not Installed</span>`;
  }
  return escapeHtml(value);
}

function renderFieldTable(fields: { label: string; value: string }[]): string {
  const rows = fields
    .map(
      (f) => `<tr>
  <td style="padding:8px 12px 8px 0;vertical-align:top;font-weight:600;color:#374151;width:38%;max-width:180px;">${escapeHtml(f.label)}</td>
  <td style="padding:8px 0;vertical-align:top;color:#111827;">${highlightNotInstalled(f.value)}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${rows}</table>`;
}

function renderHeaderCard(header: EmailLayoutDocument["header"]): string {
  return `<div style="background:#1e40af;color:#ffffff;border-radius:10px;padding:20px 22px;margin:0 0 20px;">
  <p style="margin:0 0 4px;font-size:13px;opacity:0.9;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(header.title)}</p>
  <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;font-weight:700;">${escapeHtml(header.productName)}</h1>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:14px;">
    <tr><td style="padding:4px 12px 4px 0;opacity:0.85;width:120px;">Customer</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(header.customer)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;opacity:0.85;">Asset #</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(header.assetNumber)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;opacity:0.85;">Submitted</td><td style="padding:4px 0;">${escapeHtml(header.submittedAt)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;opacity:0.85;">Installer</td><td style="padding:4px 0;">${escapeHtml(header.installer)}</td></tr>
  </table>
</div>`;
}

function renderSectionCard(section: { title: string; fields: { label: string; value: string }[] }): string {
  return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px;margin:0 0 16px;background:#ffffff;">
  <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#111827;border-bottom:1px solid #e5e7eb;padding-bottom:8px;">${escapeHtml(section.title)}</h2>
  ${renderFieldTable(section.fields)}
</div>`;
}

export function renderEmailLayoutHtml(args: {
  document: EmailLayoutDocument;
  photoSections: EmailPhotoSection[];
  mode: PhotoHtmlRenderMode;
  cidByStoragePath?: Map<string, string> | Record<string, string>;
  attachmentFailures?: string[];
}): string {
  const bodyParts = [
    renderHeaderCard(args.document.header),
    ...args.document.sections.map((s) => renderSectionCard(s)),
    renderPhotoSectionsHtml(args.photoSections, {
      mode: args.mode,
      cidByStoragePath: args.cidByStoragePath,
      attachmentFailures: args.attachmentFailures,
    }),
    `<p style="margin:24px 0 0;font-size:11px;color:#9ca3af;">Submission ref: ${escapeHtml(args.document.submissionId.slice(0, 8))}…</p>`,
  ];
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="max-width:640px;margin:0 auto;padding:16px 12px 32px;font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111827;">
${bodyParts.join("\n")}
</div>
</body>
</html>`;
}

export function renderEmailLayoutPlainWithPhotos(
  document: EmailLayoutDocument,
  photoText: string,
  failureBlock?: string,
): string {
  const parts = [renderLayoutDocumentPlainText(document)];
  if (failureBlock?.trim()) parts.push("", failureBlock.trim());
  if (photoText.trim()) parts.push("", photoText.trim());
  return parts.join("\n").trimEnd();
}
