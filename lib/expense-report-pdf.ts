/**
 * Renders a project's expense report (category totals + individual expenses + receipts) into a
 * standalone PDF. Isomorphic (Uint8Array in/out, no Buffer/fs) so it can run either server-side
 * (the /api/expense-report route) or client-side if ever needed — pdf-lib itself works in both.
 *
 * PDF receipts are appended as their own real pages (copied from the source PDF) rather than
 * rasterized into the photo grid — a scanned/exported PDF receipt should stay a real PDF page,
 * not a screenshot of one.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type ExpenseReportHeader = {
  companyName: string;
  projectName: string;
  customerName: string;
  generatedAt: string;
};

export type ExpenseReportCategoryTotal = { category: string; total: number };

export type ExpenseReportLine = {
  amount: number;
  category: string;
  date: string;
  addedBy: string;
  notes: string;
  receiptStatus: "Receipt attached" | "Lost receipt" | "No receipt";
};

export type ExpenseReceiptAsset = {
  captionLabel: string;
  contentType: "image/jpeg" | "image/png" | "application/pdf";
  bytes: Uint8Array;
};

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TITLE_SIZE = 18;
const SECTION_TITLE_SIZE = 13;
const FIELD_SIZE = 9.5;
const LINE_GAP = 3;
const PHOTO_MAX_WIDTH = 240;
const PHOTO_MAX_HEIGHT = 200;
const PHOTO_GUTTER = 16;
const PHOTOS_PER_ROW = 2;
const CAPTION_SIZE = 7.5;
const CAPTION_LINE_HEIGHT = 9;
const CAPTION_MAX_LINES = 2;
const CELL_GAP_Y = 20;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

class PdfCursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regularFont: PDFFont;
  boldFont: PDFFont;

  constructor(doc: PDFDocument, page: PDFPage, regularFont: PDFFont, boldFont: PDFFont) {
    this.doc = doc;
    this.page = page;
    this.y = PAGE_HEIGHT - MARGIN;
    this.regularFont = regularFont;
    this.boldFont = boldFont;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensureSpace(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }

  drawLine(
    text: string,
    opts: { size: number; bold?: boolean; color?: ReturnType<typeof rgb>; gapAfter?: number; align?: "left" | "center" },
  ) {
    this.ensureSpace(opts.size + LINE_GAP);
    const font = opts.bold ? this.boldFont : this.regularFont;
    const x = opts.align === "center" ? (PAGE_WIDTH - font.widthOfTextAtSize(text, opts.size)) / 2 : MARGIN;
    this.page.drawText(text, {
      x,
      y: this.y - opts.size,
      size: opts.size,
      font,
      color: opts.color ?? rgb(0.1, 0.1, 0.12),
    });
    this.y -= opts.size + (opts.gapAfter ?? LINE_GAP);
  }

  drawWrapped(text: string, opts: { size: number; bold?: boolean; color?: ReturnType<typeof rgb>; maxWidth?: number }) {
    const font = opts.bold ? this.boldFont : this.regularFont;
    const lines = wrapText(text, font, opts.size, opts.maxWidth ?? CONTENT_WIDTH);
    for (const line of lines) {
      this.ensureSpace(opts.size + LINE_GAP);
      this.page.drawText(line, {
        x: MARGIN,
        y: this.y - opts.size,
        size: opts.size,
        font,
        color: opts.color ?? rgb(0.1, 0.1, 0.12),
      });
      this.y -= opts.size + LINE_GAP;
    }
  }

  drawDivider() {
    this.ensureSpace(10);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.75,
      color: rgb(0.82, 0.82, 0.85),
    });
    this.y -= 12;
  }
}

function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: width * scale, height: height * scale };
}

export async function buildExpenseReportPdf(args: {
  header: ExpenseReportHeader;
  categoryTotals: ExpenseReportCategoryTotal[];
  grandTotal: number;
  lines: ExpenseReportLine[];
  receipts: ExpenseReceiptAsset[];
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const firstPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const cursor = new PdfCursor(pdf, firstPage, regularFont, boldFont);

  cursor.drawLine("EXPENSE REPORT", { size: TITLE_SIZE, bold: true, gapAfter: 4, align: "center" });
  cursor.drawLine(args.header.projectName, {
    size: FIELD_SIZE + 2,
    bold: true,
    color: rgb(0.15, 0.35, 0.75),
    gapAfter: 10,
    align: "center",
  });
  cursor.drawWrapped(`Company: ${args.header.companyName}`, { size: FIELD_SIZE });
  cursor.drawWrapped(`Customer: ${args.header.customerName}`, { size: FIELD_SIZE });
  cursor.drawWrapped(`Generated: ${args.header.generatedAt}`, { size: FIELD_SIZE });
  cursor.y -= 4;
  cursor.drawDivider();

  // Totals by category
  cursor.ensureSpace(SECTION_TITLE_SIZE + 14 + FIELD_SIZE + LINE_GAP);
  cursor.drawLine("TOTALS BY CATEGORY", { size: SECTION_TITLE_SIZE, bold: true, gapAfter: 6 });
  if (args.categoryTotals.length === 0) {
    cursor.drawWrapped("No expenses logged.", { size: FIELD_SIZE, color: rgb(0.45, 0.45, 0.48) });
  }
  for (const row of args.categoryTotals) {
    cursor.drawWrapped(`${row.category}: ${formatCurrency(row.total)}`, { size: FIELD_SIZE });
  }
  cursor.y -= 2;
  cursor.drawLine(`Grand Total: ${formatCurrency(args.grandTotal)}`, { size: FIELD_SIZE + 1, bold: true, gapAfter: 4 });
  cursor.y -= 4;
  cursor.drawDivider();

  // Individual expenses
  cursor.ensureSpace(SECTION_TITLE_SIZE + 14 + FIELD_SIZE * 3);
  cursor.drawLine("EXPENSES", { size: SECTION_TITLE_SIZE, bold: true, gapAfter: 8 });
  if (args.lines.length === 0) {
    cursor.drawWrapped("No expenses logged for this project.", { size: FIELD_SIZE, color: rgb(0.45, 0.45, 0.48) });
  }
  for (const line of args.lines) {
    const lineHeight = FIELD_SIZE * 2 + LINE_GAP * 2 + (line.notes ? FIELD_SIZE + LINE_GAP : 0) + 10;
    cursor.ensureSpace(lineHeight);
    cursor.drawLine(`${formatCurrency(line.amount)} — ${line.category}`, { size: FIELD_SIZE + 1, bold: true });
    cursor.drawWrapped(`${line.date} · Added by ${line.addedBy} · ${line.receiptStatus}`, {
      size: FIELD_SIZE,
      color: rgb(0.4, 0.4, 0.43),
    });
    if (line.notes.trim()) {
      cursor.drawWrapped(line.notes.trim(), { size: FIELD_SIZE });
    }
    cursor.y -= 6;
  }
  cursor.drawDivider();

  // Receipts — images packed into a continuous 2-column grid
  const imageReceipts = args.receipts.filter((r) => r.contentType !== "application/pdf");
  if (imageReceipts.length > 0) {
    const firstRowHeight = PHOTO_MAX_HEIGHT + 4 + CAPTION_MAX_LINES * CAPTION_LINE_HEIGHT;
    cursor.ensureSpace(SECTION_TITLE_SIZE + 14 + firstRowHeight + CELL_GAP_Y);
    cursor.drawLine("RECEIPTS", { size: SECTION_TITLE_SIZE, bold: true, gapAfter: 8 });

    let col = 0;
    let rowMaxHeight = 0;
    let rowStartY = cursor.y;

    for (const receipt of imageReceipts) {
      let embedded;
      try {
        embedded =
          receipt.contentType === "image/png"
            ? await pdf.embedPng(receipt.bytes)
            : await pdf.embedJpg(receipt.bytes);
      } catch (error) {
        // Was silently skipping a bad receipt with zero trace — cost real debugging time
        // tracking down a self-fetch that returned a 200 OK auth interstitial instead of a
        // PNG. Log it so a future "receipt just doesn't show up" report is diagnosable.
        console.warn("[expense-report-pdf] failed to embed receipt image, skipping", {
          caption: receipt.captionLabel,
          contentType: receipt.contentType,
          bytes: receipt.bytes.byteLength,
          error,
        });
        continue;
      }

      const box = fitWithin(embedded.width, embedded.height, PHOTO_MAX_WIDTH, PHOTO_MAX_HEIGHT);
      const captionLines = wrapText(receipt.captionLabel, regularFont, CAPTION_SIZE, PHOTO_MAX_WIDTH).slice(0, CAPTION_MAX_LINES);
      const cellHeight = box.height + 4 + captionLines.length * CAPTION_LINE_HEIGHT;

      if (col === 0) {
        cursor.ensureSpace(cellHeight + CELL_GAP_Y);
        rowStartY = cursor.y;
        rowMaxHeight = 0;
      }

      const x = MARGIN + col * (PHOTO_MAX_WIDTH + PHOTO_GUTTER);
      const y = rowStartY - box.height;
      cursor.page.drawImage(embedded, { x, y, width: box.width, height: box.height });
      captionLines.forEach((line, i) => {
        cursor.page.drawText(line, {
          x,
          y: y - 10 - i * CAPTION_LINE_HEIGHT,
          size: CAPTION_SIZE,
          font: regularFont,
          color: rgb(0.4, 0.4, 0.43),
        });
      });

      rowMaxHeight = Math.max(rowMaxHeight, cellHeight);
      col += 1;
      if (col >= PHOTOS_PER_ROW) {
        col = 0;
        cursor.y = rowStartY - rowMaxHeight - CELL_GAP_Y;
      }
    }
    if (col !== 0) cursor.y = rowStartY - rowMaxHeight - CELL_GAP_Y;
    cursor.y -= 6;
    cursor.drawDivider();
  }

  // PDF receipts — appended directly as their own real pages, no divider/caption page in front
  // of them (that page was nearly blank and just added whitespace before the actual receipt).
  const pdfReceipts = args.receipts.filter((r) => r.contentType === "application/pdf");
  for (const receipt of pdfReceipts) {
    try {
      const sourceDoc = await PDFDocument.load(receipt.bytes);
      const copiedPages = await pdf.copyPages(sourceDoc, sourceDoc.getPageIndices());
      for (const page of copiedPages) pdf.addPage(page);
    } catch {
      // Rare path (unreadable receipt) — still worth a page so the skip isn't silent.
      cursor.newPage();
      cursor.drawLine("RECEIPT (PDF)", { size: SECTION_TITLE_SIZE, bold: true, gapAfter: 6 });
      cursor.drawWrapped(receipt.captionLabel, { size: FIELD_SIZE });
      cursor.drawWrapped("(This receipt PDF could not be read and was skipped.)", {
        size: FIELD_SIZE,
        color: rgb(0.7, 0.25, 0.25),
      });
    }
  }

  return pdf.save();
}
