/**
 * Renders an already-built layout document + photo sections + already-fetched photo attachments
 * into job-card PDF bytes, plus the shared filename convention. Deliberately kept free of value
 * imports into email-layout-model.ts/email-cid-attachments.ts (only type-only imports, which
 * --experimental-strip-types elides) so this file loads directly under the plain Node test
 * runner — the same constraint email-pdf.ts/email-photo-sections.ts already follow. The fuller
 * stored-submission -> PDF pipeline that needs those modules as real values lives in
 * lib/job-card-pdf-generation.ts instead.
 */
import { buildJobCardPdf, type PdfImageSource } from "./email-pdf.ts";
import { sanitizeFilenamePart } from "./email-attachment-filenames.ts";
import type { EmailLayoutDocument } from "./email-layout-model.ts";
import type { EmailPhotoSection } from "./email-photo-sections.ts";
import type { ResendInlinePhotoAttachment } from "./email-cid-attachments.ts";
import type { JobCardSubmissionPayload } from "./job-card-submission.ts";

export type JobCardPdfFilenameContext = { customer: string; assetNumber: string };

/** Same customer/asset fallback chain already used for filenames elsewhere (send-email/route.ts, email-view-model.ts). */
export function jobCardPdfFilenameContext(payload: JobCardSubmissionPayload): JobCardPdfFilenameContext {
  return {
    customer: payload.linxup?.customer || payload.coreJobInfo.customer || "Customer",
    assetNumber: payload.linxup?.assetNumber || payload.coreJobInfo.unitNumber || "Unit",
  };
}

export function jobCardPdfFilename(ctx: JobCardPdfFilenameContext): string {
  return `${[sanitizeFilenamePart(ctx.customer, 32), sanitizeFilenamePart(ctx.assetNumber, 24), "JobCard"]
    .filter(Boolean)
    .join("_")}.pdf`;
}

/**
 * Renders a PDF from an already-built layout document, photo sections, and already-fetched photo
 * attachments (storagePath + content + contentType). Never fetches from Storage itself — callers
 * that don't already have photos fetched should use regenerateJobCardPdfForSubmission instead
 * (lib/job-card-pdf-generation.ts).
 */
export async function renderJobCardPdfAttachment(
  layoutDocument: EmailLayoutDocument,
  photoSections: EmailPhotoSection[],
  photoAttachments: Array<Pick<ResendInlinePhotoAttachment, "storagePath" | "content" | "contentType">>,
): Promise<Buffer> {
  const imagesByStoragePath = new Map<string, PdfImageSource>(
    photoAttachments.map((a) => [
      a.storagePath,
      { storagePath: a.storagePath, buffer: a.content, contentType: a.contentType as "image/jpeg" | "image/png" },
    ]),
  );
  return buildJobCardPdf(layoutDocument, photoSections, imagesByStoragePath);
}
