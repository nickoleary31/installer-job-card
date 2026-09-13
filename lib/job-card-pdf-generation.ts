/**
 * Shared stored-submission -> job-card-PDF pipeline, extracted from app/api/send-email/route.ts
 * so the outbound email attachment and the standalone SA-scoped evidence PDF endpoint (see
 * app/api/integrations/zoho-fsm/evidence/pdf/route.ts) both render through the exact same code
 * path instead of two independent implementations drifting apart over time.
 *
 * regenerateJobCardPdfForSubmission is the full pipeline starting from just a stored submission
 * payload — builds the layout document, the photo sections, and fetches+optimizes the photos
 * itself via Storage. The email route already has photos fetched (for CID embedding in the HTML
 * body) and reuses that fetch instead — see renderJobCardPdfAttachment in
 * lib/job-card-pdf-attachment.ts, re-exported here for a single import path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEmailLayoutDocument } from "./email-layout-model.ts";
import { buildEmailPhotoSections } from "./email-photo-sections.ts";
import { buildCidPhotoAttachments } from "./email-cid-attachments.ts";
import { jobCardPdfFilename, jobCardPdfFilenameContext, renderJobCardPdfAttachment } from "./job-card-pdf-attachment.ts";
import type { JobCardSubmissionPayload } from "./job-card-submission.ts";

export {
  jobCardPdfFilename,
  jobCardPdfFilenameContext,
  renderJobCardPdfAttachment,
  type JobCardPdfFilenameContext,
} from "./job-card-pdf-attachment.ts";

/**
 * Full pipeline: regenerates the CURRENT job-card PDF for a stored submission payload, fetching
 * and optimizing its photos from Storage itself. Produces the same field/photo content as the
 * outbound email attachment for the same payload — includeProductFileLinks: false and no
 * attachedProductFileKeys, matching the outbound (never Email Preview) rendering path.
 */
export async function regenerateJobCardPdfForSubmission(
  payload: JobCardSubmissionPayload,
  options?: { supabase?: SupabaseClient },
): Promise<{ buffer: Buffer; filename: string }> {
  const layoutDocument = buildEmailLayoutDocument(payload, { includeProductFileLinks: false });
  const sections = buildEmailPhotoSections(payload);
  const filenameContext = jobCardPdfFilenameContext(payload);
  const photoAttachments = await buildCidPhotoAttachments(sections, {
    filenameContext,
    supabase: options?.supabase,
  });
  const buffer = await renderJobCardPdfAttachment(layoutDocument, photoAttachments.photoSections, photoAttachments.attachments);
  return { buffer, filename: jobCardPdfFilename(filenameContext) };
}
