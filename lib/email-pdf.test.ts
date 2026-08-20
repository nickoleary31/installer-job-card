import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { buildJobCardPdf, type PdfImageSource } from "./email-pdf.ts";
import type { EmailLayoutDocument } from "./email-layout-model.ts";
import type { EmailPhotoSection } from "./email-photo-sections.ts";

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
      fields: [
        { label: "Customer", value: "Southwest Feed Yard" },
        { label: "Location", value: "3865FM 2943 Hereford Tx" },
        { label: "Work Order #", value: "WO-SWfeedyard" },
      ],
    },
    {
      id: "empty",
      title: "Empty Section",
      fields: [],
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

describe("email-pdf", () => {
  it("produces a valid PDF buffer with text sections", async () => {
    const pdf = await buildJobCardPdf(document, [], new Map());
    assert.ok(pdf.byteLength > 0);
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("embeds photos referenced in photoSections when a matching image buffer is provided", async () => {
    const photoSections: EmailPhotoSection[] = [
      {
        heading: "PPD PHOTOS",
        fields: [
          {
            fieldName: "blaxtair5Camera1",
            label: "Blaxtair 5 — camera 1 label",
            photos: [
              {
                fieldName: "blaxtair5Camera1",
                label: "Blaxtair 5 — camera 1 label",
                filename: "camera1.jpg",
                storagePath: "job-card-photos/fake/camera1.jpg",
                previewUrl: "",
              },
            ],
          },
        ],
      },
    ];
    const imagesByStoragePath = new Map<string, PdfImageSource>([
      [
        "job-card-photos/fake/camera1.jpg",
        {
          storagePath: "job-card-photos/fake/camera1.jpg",
          buffer: await testJpeg("#336699"),
          contentType: "image/jpeg",
        },
      ],
    ]);

    const pdf = await buildJobCardPdf(document, photoSections, imagesByStoragePath);
    assert.ok(pdf.byteLength > 500);
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("skips a photo silently when no matching image buffer is provided (never throws)", async () => {
    const photoSections: EmailPhotoSection[] = [
      {
        heading: "PPD PHOTOS",
        fields: [
          {
            fieldName: "blaxtair5Hub",
            label: "Blaxtair 5 — camera hub label",
            photos: [
              {
                fieldName: "blaxtair5Hub",
                label: "Blaxtair 5 — camera hub label",
                filename: "hub.jpg",
                storagePath: "job-card-photos/fake/hub.jpg",
                previewUrl: "",
              },
            ],
          },
        ],
      },
    ];
    const pdf = await buildJobCardPdf(document, photoSections, new Map());
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("paginates across many photos without throwing", async () => {
    const photos = Array.from({ length: 10 }, (_, i) => ({
      fieldName: `photo${i}`,
      label: `Photo ${i}`,
      filename: `p${i}.jpg`,
      storagePath: `job-card-photos/fake/p${i}.jpg`,
      previewUrl: "",
    }));
    const photoSections: EmailPhotoSection[] = [
      { heading: "PHOTOS", fields: photos.map((p) => ({ fieldName: p.fieldName, label: p.label, photos: [p] })) },
    ];
    const buf = await testJpeg("#996633");
    const imagesByStoragePath = new Map<string, PdfImageSource>(
      photos.map((p) => [p.storagePath, { storagePath: p.storagePath, buffer: buf, contentType: "image/jpeg" }]),
    );
    const pdf = await buildJobCardPdf(document, photoSections, imagesByStoragePath);
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  });
});
