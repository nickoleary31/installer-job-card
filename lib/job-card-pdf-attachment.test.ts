import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { jobCardPdfFilename, jobCardPdfFilenameContext, renderJobCardPdfAttachment } from "./job-card-pdf-attachment.ts";
import type { EmailLayoutDocument } from "./email-layout-model.ts";
import type { EmailPhotoSection } from "./email-photo-sections.ts";
import type { ResendInlinePhotoAttachment } from "./email-cid-attachments.ts";
import type { JobCardSubmissionPayload } from "./job-card-submission.ts";

const document: EmailLayoutDocument = {
  header: {
    title: "Installer Job Card",
    productName: "Blaxtair 5",
    customer: "Southwest Feed Yard",
    assetNumber: "30",
    submittedAt: "Aug 19, 2026, 7:44 PM",
    installer: "Stephen Boyd",
  },
  sections: [
    {
      id: "core",
      title: "Core Job Information",
      fields: [{ label: "Customer", value: "Southwest Feed Yard" }],
    },
  ],
  submissionId: "sub-123",
  formId: "blaxtair_5",
};

async function testJpeg(color: string): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: color } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe("job-card-pdf-attachment", () => {
  describe("jobCardPdfFilenameContext", () => {
    it("prefers linxup customer/assetNumber over coreJobInfo when present", () => {
      const payload = {
        coreJobInfo: { customer: "Core Customer", unitNumber: "Core-Unit" },
        linxup: { customer: "LinxUp Customer", assetNumber: "LinxUp-Unit" },
      } as unknown as JobCardSubmissionPayload;
      assert.deepEqual(jobCardPdfFilenameContext(payload), { customer: "LinxUp Customer", assetNumber: "LinxUp-Unit" });
    });

    it("falls back to coreJobInfo, then to Customer/Unit defaults", () => {
      const payload = {
        coreJobInfo: { customer: "", unitNumber: "" },
      } as unknown as JobCardSubmissionPayload;
      assert.deepEqual(jobCardPdfFilenameContext(payload), { customer: "Customer", assetNumber: "Unit" });
    });
  });

  describe("jobCardPdfFilename", () => {
    it("joins sanitized customer/asset with a JobCard suffix", () => {
      assert.equal(jobCardPdfFilename({ customer: "Southwest Feed Yard", assetNumber: "30" }), "Southwest_Feed_Yard_30_JobCard.pdf");
    });
  });

  describe("renderJobCardPdfAttachment", () => {
    it("produces a valid PDF buffer", async () => {
      const pdf = await renderJobCardPdfAttachment(document, [], []);
      assert.ok(pdf.byteLength > 0);
      assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    });

    it("maps already-fetched photo attachments (content/contentType) by storagePath into the rendered PDF", async () => {
      const photoSections: EmailPhotoSection[] = [
        {
          heading: "PHOTOS",
          fields: [
            {
              fieldName: "vehicleFront",
              label: "Vehicle front",
              photos: [
                {
                  fieldName: "vehicleFront",
                  label: "Vehicle front",
                  filename: "front.jpg",
                  storagePath: "job-card-photos/fake/front.jpg",
                  previewUrl: "",
                },
              ],
            },
          ],
        },
      ];
      const attachments: Array<Pick<ResendInlinePhotoAttachment, "storagePath" | "content" | "contentType">> = [
        {
          storagePath: "job-card-photos/fake/front.jpg",
          content: await testJpeg("#336699"),
          contentType: "image/jpeg",
        },
      ];

      const pdf = await renderJobCardPdfAttachment(document, photoSections, attachments);
      assert.ok(pdf.byteLength > 500);
      assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    });
  });
});
