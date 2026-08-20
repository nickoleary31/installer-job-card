import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { buildExpenseReportPdf, type ExpenseReceiptAsset } from "./expense-report-pdf.ts";

const header = {
  companyName: "Acme Installs",
  projectName: "Nucor Terrell",
  customerName: "Nucor",
  generatedAt: "Aug 20, 2026, 6:22 PM",
};

async function testJpeg(): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#336699" } })
    .jpeg({ quality: 90 })
    .toBuffer();
  return new Uint8Array(buf);
}

async function testReceiptPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) doc.addPage([300, 400]);
  return doc.save();
}

describe("expense-report-pdf", () => {
  it("produces a valid PDF with category totals and expense lines", async () => {
    const pdf = await buildExpenseReportPdf({
      header,
      categoryTotals: [
        { category: "Travel - Meals", total: 45.2 },
        { category: "Travel - Fuel", total: 26.01 },
      ],
      grandTotal: 71.21,
      lines: [
        { amount: 45.2, category: "Travel - Meals", date: "8/9/2026", addedBy: "Michael Yorish", notes: "", receiptStatus: "Receipt attached" },
        { amount: 26.01, category: "Travel - Fuel", date: "8/9/2026", addedBy: "Michael Yorish", notes: "No receipt.", receiptStatus: "Lost receipt" },
      ],
      receipts: [],
    });
    assert.ok(pdf.byteLength > 0);
    assert.equal(Buffer.from(pdf.slice(0, 5)).toString("latin1"), "%PDF-");
  });

  it("embeds image receipts and appends PDF receipts as real extra pages", async () => {
    const imageReceipt: ExpenseReceiptAsset = {
      captionLabel: "$45.20 — Travel - Meals — 8/9/2026",
      contentType: "image/jpeg",
      bytes: await testJpeg(),
    };
    const pdfReceiptBytes = await testReceiptPdf(2);
    const pdfReceipt: ExpenseReceiptAsset = {
      captionLabel: "$137.58 — Travel - Car Rental — 8/9/2026",
      contentType: "application/pdf",
      bytes: pdfReceiptBytes,
    };

    const baselinePdf = await buildExpenseReportPdf({
      header,
      categoryTotals: [{ category: "Travel - Meals", total: 45.2 }],
      grandTotal: 182.78,
      lines: [],
      receipts: [imageReceipt],
    });
    const baselineDoc = await PDFDocument.load(baselinePdf);
    const baselinePageCount = baselineDoc.getPageCount();

    const withPdfReceipt = await buildExpenseReportPdf({
      header,
      categoryTotals: [{ category: "Travel - Meals", total: 45.2 }],
      grandTotal: 182.78,
      lines: [],
      receipts: [imageReceipt, pdfReceipt],
    });
    const combinedDoc = await PDFDocument.load(withPdfReceipt);
    // The 2-page receipt PDF must show up as exactly 2 additional real pages — no divider/
    // caption page in front of them (that page was nearly blank and just added whitespace).
    assert.equal(combinedDoc.getPageCount(), baselinePageCount + 2);
  });

  it("skips a receipt with unreadable bytes instead of throwing", async () => {
    const badPdfReceipt: ExpenseReceiptAsset = {
      captionLabel: "$10.00 — Misc — 8/9/2026",
      contentType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3, 4]),
    };
    const pdf = await buildExpenseReportPdf({
      header,
      categoryTotals: [],
      grandTotal: 0,
      lines: [],
      receipts: [badPdfReceipt],
    });
    assert.equal(Buffer.from(pdf.slice(0, 5)).toString("latin1"), "%PDF-");
  });
});
