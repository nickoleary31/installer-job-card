/**
 * Node/sharp aggressive barcode decode for fixture eval (LinxCam vertical 1D).
 */
import sharp from "sharp";
import zxing from "@zxing/library";

const {
  BinaryBitmap,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
  DecodeHintType,
  BarcodeFormat,
} = zxing;

async function decodeRaw(raw: Buffer, width: number, height: number, channels: number): Promise<string[]> {
  const luminance = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < raw.length; i += channels, j += 1) {
    luminance[j] = ((raw[i] * 0.299 + raw[i + 1] * 0.587 + raw[i + 2] * 0.114) | 0) as number;
  }
  const source = new RGBLuminanceSource(luminance, width, height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.EAN_13,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  try {
    const text = reader.decode(bitmap).getText()?.trim();
    return text ? [text] : [];
  } catch {
    return [];
  }
}

type Crop = { left: number; top: number; width: number; height: number };

function relativeCrops(w: number, h: number): Crop[] {
  const r = (x: number, y: number, rw: number, rh: number): Crop => ({
    left: Math.max(0, Math.round(x * w)),
    top: Math.max(0, Math.round(y * h)),
    width: Math.max(8, Math.round(rw * w)),
    height: Math.max(8, Math.round(rh * h)),
  });
  return [
    r(0.05, 0.15, 0.45, 0.55),
    r(0.5, 0.15, 0.45, 0.55),
    r(0.08, 0.1, 0.38, 0.42),
    r(0.52, 0.1, 0.4, 0.42),
    r(0.1, 0.35, 0.8, 0.4),
    r(0, 0, 1, 1),
  ];
}

export async function decodeBarcodesAggressiveNode(input: Buffer): Promise<{
  payloads: string[];
  attempts: number;
}> {
  const found = new Set<string>();
  let attempts = 0;
  const meta = await sharp(input).metadata();
  const baseW = meta.width || 1;
  const baseH = meta.height || 1;

  const angles = [0, 90, 270, 180];
  const scales = [1, 1.5, 2, 2.5];

  for (const angle of angles) {
    const rotated = await sharp(input).rotate(angle).png().toBuffer();
    const { width: rw, height: rh } = await sharp(rotated).metadata();
    const w = rw || baseW;
    const h = rh || baseH;

    for (const crop of relativeCrops(w, h)) {
      const clipped = {
        left: Math.min(crop.left, Math.max(0, w - 8)),
        top: Math.min(crop.top, Math.max(0, h - 8)),
        width: Math.min(crop.width, w - Math.min(crop.left, w - 8)),
        height: Math.min(crop.height, h - Math.min(crop.top, h - 8)),
      };

      const pipelines: Array<() => Promise<Buffer>> = [
        async () => sharp(rotated).extract(clipped).png().toBuffer(),
        async () => sharp(rotated).extract(clipped).grayscale().normalize().sharpen().png().toBuffer(),
        async () =>
          sharp(rotated)
            .extract(clipped)
            .grayscale()
            .normalize()
            .threshold(120)
            .png()
            .toBuffer(),
        async () =>
          sharp(rotated)
            .extract(clipped)
            .grayscale()
            .normalize()
            .threshold(150)
            .png()
            .toBuffer(),
        async () =>
          sharp(rotated)
            .extract(clipped)
            .grayscale()
            .linear(1.4, -20)
            .sharpen()
            .png()
            .toBuffer(),
      ];

      for (const build of pipelines) {
        let png: Buffer;
        try {
          png = await build();
        } catch {
          continue;
        }
        for (const scale of scales) {
          const scaled =
            scale === 1
              ? png
              : await sharp(png)
                  .resize({
                    width: Math.round(((await sharp(png).metadata()).width || 100) * scale),
                    kernel: sharp.kernel.nearest,
                  })
                  .png()
                  .toBuffer();
          const raw = await sharp(scaled).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          attempts += 1;
          for (const p of await decodeRaw(raw.data, raw.info.width, raw.info.height, 4)) {
            found.add(p);
          }
          if (found.size >= 2) return { payloads: [...found], attempts };
        }
      }
    }
  }

  return { payloads: [...found], attempts };
}
