import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { optimizeImageForEmailAttachment } from "../lib/email-photo-optimize.ts";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return out;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const { data, error } = await sb
  .from("job_card_submissions")
  .select("submission_id,payload,customer,unit_number")
  .order("created_at", { ascending: false })
  .limit(50);

if (error) {
  console.error(error);
  process.exit(1);
}

const row = (data || []).find((r) => {
  const p = r.payload as {
    linxup?: { assetNumber?: string; customer?: string };
    coreJobInfo?: { unitNumber?: string; customer?: string };
  };
  const asset = p?.linxup?.assetNumber || p?.coreJobInfo?.unitNumber || "";
  const customer = p?.linxup?.customer || p?.coreJobInfo?.customer || "";
  return String(asset).toUpperCase() === "E2" && /low country/i.test(String(customer));
});

if (!row) {
  console.log(JSON.stringify({ found: false, message: "No E2 Low Country submission in last 50 rows" }, null, 2));
  process.exit(0);
}

const photos = (row.payload as { photoUploads?: Array<{ label?: string; group?: string; storagePath?: string }> })
  .photoUploads || [];
const results: unknown[] = [];
let totalOptimized = 0;

for (const photo of photos) {
  const path = photo.storagePath;
  if (!path) continue;
  const { data: blob, error: dlErr } = await sb.storage.from("job-card-photos").download(path);
  if (dlErr || !blob) {
    results.push({ label: photo.label, path, error: dlErr?.message || "download failed" });
    continue;
  }
  const raw = Buffer.from(await blob.arrayBuffer());
  try {
    const opt = await optimizeImageForEmailAttachment(raw);
    totalOptimized += opt.optimizedBytes;
    results.push({
      label: photo.label,
      path,
      originalBytes: opt.originalBytes,
      originalMB: (opt.originalBytes / (1024 * 1024)).toFixed(2),
      optimizedBytes: opt.optimizedBytes,
      optimizedKB: (opt.optimizedBytes / 1024).toFixed(0),
      dimensions: `${opt.width}x${opt.height}`,
    });
  } catch (e) {
    results.push({ label: photo.label, path, error: e instanceof Error ? e.message : String(e) });
  }
}

console.log(
  JSON.stringify(
    {
      submissionId: row.submission_id,
      photoCount: photos.length,
      optimizedReport: results,
      totalOptimizedMB: (totalOptimized / (1024 * 1024)).toFixed(2),
    },
    null,
    2,
  ),
);
