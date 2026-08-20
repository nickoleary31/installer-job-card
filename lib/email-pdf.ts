/**
 * Renders the same structured content the outbound email shows (EmailLayoutDocument +
 * photo sections) into a standalone PDF attachment.
 *
 * Deliberately built with pdf-lib (pure JS/TS, no native binary) rather than an HTML-to-PDF
 * approach (e.g. headless Chromium) — after the sharp/libvips outage, a second native-binary
 * dependency on Vercel is exactly the risk we just spent a night fixing our way out of.
 *
 * PDF generation is best-effort: a failure here must never block the actual email send, so
 * callers should wrap buildJobCardPdf in a try/catch and simply omit the attachment on error.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { EmailLayoutDocument } from "./email-layout-model.ts";
import type { EmailPhotoSection } from "./email-photo-sections.ts";
import { optimizeImageForEmailAttachment } from "./email-photo-optimize.ts";

export type PdfImageSource = {
  storagePath: string;
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png";
};

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TITLE_SIZE = 18;
const HEADER_SIZE = 11;
const SECTION_TITLE_SIZE = 13;
const FIELD_SIZE = 9.5;
const LINE_GAP = 3;
const PHOTO_MAX_WIDTH = 240;
const PHOTO_MAX_HEIGHT = 200;
const PHOTO_GUTTER = 16;
const PHOTOS_PER_ROW = 2;
/** Re-shrink already email-optimized images further — the PDF only needs thumbnail-scale prints. */
const PDF_IMAGE_MAX_LONG_EDGE = 700;
const PDF_IMAGE_TARGET_BYTES = 220 * 1024;
const PDF_IMAGE_HARD_MAX_BYTES = 500 * 1024;

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
    const x =
      opts.align === "center" ? (PAGE_WIDTH - font.widthOfTextAtSize(text, opts.size)) / 2 : MARGIN;
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

function fieldLine(cursor: PdfCursor, label: string, value: string) {
  const text = `${label}: ${value || "—"}`;
  cursor.drawWrapped(text, { size: FIELD_SIZE });
}

async function embedForPdf(
  doc: PDFDocument,
  source: PdfImageSource,
): Promise<{ image: Awaited<ReturnType<PDFDocument["embedJpg"]>>; width: number; height: number } | null> {
  try {
    const shrunk = await optimizeImageForEmailAttachment(source.buffer, {
      maxLongEdge: PDF_IMAGE_MAX_LONG_EDGE,
      targetBytes: PDF_IMAGE_TARGET_BYTES,
      hardMaxBytes: PDF_IMAGE_HARD_MAX_BYTES,
    });
    const image =
      shrunk.contentType === "image/png" ? await doc.embedPng(shrunk.buffer) : await doc.embedJpg(shrunk.buffer);
    return { image, width: shrunk.width, height: shrunk.height };
  } catch {
    return null;
  }
}

function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: width * scale, height: height * scale };
}

export async function buildJobCardPdf(
  document: EmailLayoutDocument,
  photoSections: EmailPhotoSection[],
  imagesByStoragePath: Map<string, PdfImageSource>,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const firstPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const cursor = new PdfCursor(pdf, firstPage, regularFont, boldFont);

  cursor.drawLine("INSTALLER JOB CARD", { size: TITLE_SIZE, bold: true, gapAfter: 4, align: "center" });
  cursor.drawLine(document.header.productName, {
    size: HEADER_SIZE + 2,
    bold: true,
    color: rgb(0.15, 0.35, 0.75),
    gapAfter: 10,
    align: "center",
  });
  fieldLine(cursor, "Customer", document.header.customer);
  fieldLine(cursor, "Asset #", document.header.assetNumber);
  fieldLine(cursor, "Submitted", document.header.submittedAt);
  fieldLine(cursor, "Installer", document.header.installer);
  cursor.y -= 4;
  cursor.drawDivider();

  for (const section of document.sections) {
    // Reserve room for the heading *and* its first line of content, not just the heading —
    // otherwise a heading can land as the last line on a page with its content orphaned below.
    cursor.ensureSpace(SECTION_TITLE_SIZE + 14 + FIELD_SIZE + LINE_GAP);
    cursor.drawLine(section.title.toUpperCase(), { size: SECTION_TITLE_SIZE, bold: true, gapAfter: 6 });
    if (section.fields.length === 0) {
      cursor.drawWrapped("None", { size: FIELD_SIZE, color: rgb(0.45, 0.45, 0.48) });
    }
    for (const field of section.fields) {
      fieldLine(cursor, field.label, field.value);
    }
    cursor.y -= 6;
    cursor.drawDivider();
  }

  const CAPTION_SIZE = 7.5;
  const CAPTION_LINE_HEIGHT = 9;
  const CAPTION_MAX_LINES = 2;
  const CELL_GAP_Y = 20;

  for (const section of photoSections) {
    // Flatten every field's photos into one list so the 2-column grid packs continuously across
    // the whole section — grouping cells per field (as before) left a stranded empty column
    // whenever a field had an odd photo count (the common case: most fields have exactly 1).
    const cells: Array<{ label: string; photo: (typeof section.fields)[number]["photos"][number] }> = [];
    for (const field of section.fields) {
      field.photos.forEach((photo, i) => {
        const label = field.photos.length > 1 ? `${field.label} (${i + 1}/${field.photos.length})` : field.label;
        cells.push({ label, photo });
      });
    }
    if (cells.length === 0) continue;

    // Reserve room for the heading *and* a full first row of photos — a heading with no room
    // left for its pictures below it is the exact "orphaned header" bug this guards against.
    const firstRowHeight = PHOTO_MAX_HEIGHT + 4 + CAPTION_MAX_LINES * CAPTION_LINE_HEIGHT;
    cursor.ensureSpace(SECTION_TITLE_SIZE + 14 + firstRowHeight + CELL_GAP_Y);
    cursor.drawLine(section.heading.toUpperCase(), { size: SECTION_TITLE_SIZE, bold: true, gapAfter: 8 });

    let col = 0;
    let rowMaxHeight = 0;
    let rowStartY = cursor.y;

    for (const cell of cells) {
      const source = imagesByStoragePath.get(cell.photo.storagePath);
      if (!source) continue;
      const embedded = await embedForPdf(pdf, source);
      if (!embedded) continue;

      const box = fitWithin(embedded.width, embedded.height, PHOTO_MAX_WIDTH, PHOTO_MAX_HEIGHT);
      const captionLines = wrapText(cell.label, regularFont, CAPTION_SIZE, PHOTO_MAX_WIDTH).slice(0, CAPTION_MAX_LINES);
      const cellHeight = box.height + 4 + captionLines.length * CAPTION_LINE_HEIGHT;

      if (col === 0) {
        cursor.ensureSpace(cellHeight + CELL_GAP_Y);
        rowStartY = cursor.y;
        rowMaxHeight = 0;
      }

      const x = MARGIN + col * (PHOTO_MAX_WIDTH + PHOTO_GUTTER);
      const y = rowStartY - box.height;
      cursor.page.drawImage(embedded.image, { x, y, width: box.width, height: box.height });
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
    if (col !== 0) {
      cursor.y = rowStartY - rowMaxHeight - CELL_GAP_Y;
    }
    cursor.y -= 6;
    cursor.drawDivider();
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
