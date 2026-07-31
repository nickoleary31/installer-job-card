/**
 * Shared email-view model for Email Preview (app) and outbound Resend email (CID).
 */

import { buildEmailAttachmentFilename } from "@/lib/email-attachment-filenames";
import { renderEmailLayoutHtml, renderEmailLayoutPlainWithPhotos } from "@/lib/email-html-layout";
import { buildEmailLayoutDocument } from "@/lib/email-layout-model";
import {
  applyEmailAttachmentFilenames,
  buildEmailPhotoSections,
  renderPhotoSectionsText,
  type EmailPhotoSection,
} from "@/lib/email-photo-sections";
import { getFormDefinitionById, getFormLabelBySectionKey } from "@/lib/form-registry";
import { getProductLabelWithLookup } from "@/lib/product-config/product-lookup";
import { formatEmailSubject, type JobCardSubmissionPayload } from "@/lib/job-card-submission";

export type {
  EmailPhotoField,
  EmailPhotoItem,
  EmailPhotoSection,
} from "@/lib/email-photo-sections";

export { buildEmailPhotoSections, resolveEmailPhotoPreviewUrl as resolveEmailPhotoImageUrl } from "@/lib/email-photo-sections";
export { buildEmailLayoutDocument } from "@/lib/email-layout-model";

const DEFAULT_APP_URL = "https://install.tkptelematics.com";

export type EmailViewModel = {
  subject: string;
  layoutDocument: ReturnType<typeof buildEmailLayoutDocument>;
  textBody: string;
  htmlBody: string;
  photoSections: EmailPhotoSection[];
  photoGalleryUrl: string;
};

function resolvePublicAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (!raw) return DEFAULT_APP_URL;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return DEFAULT_APP_URL;
    if (host.endsWith(".vercel.app")) return DEFAULT_APP_URL;
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return DEFAULT_APP_URL;
  }
}

function filenameContext(p: JobCardSubmissionPayload) {
  return {
    customer: p.linxup?.customer || p.coreJobInfo.customer || "Customer",
    assetNumber: p.linxup?.assetNumber || p.coreJobInfo.unitNumber || "Unit",
  };
}

function buildSubject(p: JobCardSubmissionPayload): string {
  const productLabel =
    p.linxup?.productLabel?.trim() ||
    getProductLabelWithLookup(p.hardwareSelection?.primary, p.productDisplay) ||
    getFormLabelBySectionKey(p.hardwareSelection?.primary) ||
    getFormDefinitionById(p.formId)?.label ||
    getFormDefinitionById(p.submissionType)?.label ||
    p.submissionType ||
    p.formId;
  return formatEmailSubject(
    p.coreJobInfo.customer,
    p.linxup?.assetNumber || p.coreJobInfo.unitNumber,
    productLabel,
  );
}

function preparePhotoSections(p: JobCardSubmissionPayload): EmailPhotoSection[] {
  const ctx = filenameContext(p);
  return applyEmailAttachmentFilenames(buildEmailPhotoSections(p), ctx, buildEmailAttachmentFilename);
}

function stripStorageUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']*supabase\.co\/storage[^\s<>"']*/gi, "[storage link omitted]");
}

/** In-app Email Preview. */
export function buildEmailViewModel(p: JobCardSubmissionPayload): EmailViewModel {
  const layoutDocument = buildEmailLayoutDocument(p, { includeProductFileLinks: true });
  const photoSections = preparePhotoSections(p);
  const photoGalleryUrl = `${resolvePublicAppUrl()}/photos/${encodeURIComponent(p.submissionId)}`;
  const textBody = renderEmailLayoutPlainWithPhotos(layoutDocument, renderPhotoSectionsText(photoSections));
  const htmlBody = renderEmailLayoutHtml({
    document: layoutDocument,
    photoSections,
    mode: "preview",
  });
  return {
    subject: buildSubject(p),
    layoutDocument,
    textBody,
    htmlBody,
    photoSections,
    photoGalleryUrl,
  };
}

/** Outbound email with CID images (no Storage URLs). */
export function buildOutboundEmailBodies(
  p: JobCardSubmissionPayload,
  options: {
    cidByStoragePath: Map<string, string>;
    /** True failures only — never successful optimization notes. */
    attachmentFailures?: string[];
    photoSections?: EmailPhotoSection[];
  },
): { subject: string; textBody: string; htmlBody: string; photoSections: EmailPhotoSection[]; layoutDocument: ReturnType<typeof buildEmailLayoutDocument> } {
  // Omit Product File storage links in outbound body; files are attached when practical.
  const layoutDocument = buildEmailLayoutDocument(p, { includeProductFileLinks: false });
  const photoSections = options.photoSections ?? preparePhotoSections(p);
  const failureBlock =
    options.attachmentFailures && options.attachmentFailures.length > 0
      ? ["PHOTO ATTACHMENT FAILURES", ...options.attachmentFailures.map((f) => `- ${f}`)].join("\n")
      : "";
  const textBody = stripStorageUrls(
    renderEmailLayoutPlainWithPhotos(layoutDocument, renderPhotoSectionsText(photoSections), failureBlock),
  );
  const htmlBody = stripStorageUrls(
    renderEmailLayoutHtml({
      document: layoutDocument,
      photoSections,
      mode: "cid",
      cidByStoragePath: options.cidByStoragePath,
      attachmentFailures: options.attachmentFailures,
    }),
  );
  return {
    subject: buildSubject(p),
    textBody,
    htmlBody,
    photoSections,
    layoutDocument,
  };
}
