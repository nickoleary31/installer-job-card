/**
 * Browser OCR via Tesseract.js — prototype only (no server upload of the image).
 */

import { createWorker, type Worker } from "tesseract.js";

let sharedWorker: Worker | null = null;
let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (sharedWorker) return sharedWorker;
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        logger: () => {
          // Intentionally quiet — avoid logging OCR payloads
        },
      });
      // Prefer digits/letters common on device labels
      await worker.setParameters({
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:/\\-_.# ",
      });
      sharedWorker = worker;
      return worker;
    })();
  }
  return workerPromise;
}

export type OcrRunResult = {
  text: string;
  confidence: number;
};

export async function runLabelOcr(canvas: HTMLCanvasElement): Promise<OcrRunResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  return {
    text: data.text || "",
    confidence: typeof data.confidence === "number" ? data.confidence : 0,
  };
}

export async function terminateLabelOcrWorker(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.terminate();
    sharedWorker = null;
    workerPromise = null;
  }
}
