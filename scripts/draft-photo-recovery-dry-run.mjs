/**
 * NON-DESTRUCTIVE dry-run: draft photo relink proposals.
 *
 * - Reads job_card_drafts + lists job-card-photos Storage
 * - Writes a local report + proposed JSON patches
 * - Does NOT update database rows
 * - Does NOT move/rename/delete Storage objects
 *
 * Usage: node scripts/draft-photo-recovery-dry-run.mjs
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "job-card-photos";
const PROJECT_ID = "0f976c22-4a88-4b2a-b90c-4bb2469084a5"; // Low Country Concrete project
const OUT_DIR = path.resolve("recovery-dry-run-output");
const SIGNED_URL_TTL_SEC = 60 * 60 * 12; // 12h for manual review

const TARGETS = [
  {
    key: "S1",
    unitHint: "S1",
    submissionId: "5a40bebb-6b3d-4db2-8793-9b496927a2c5",
    mode: "merge",
    notes: "Merge 4 missing LinxUp refs; keep existing vehicle refs.",
  },
  {
    key: "TRUCK_9",
    unitHint: "TRUCK 9",
    submissionId: "8c050ce1-9af9-4654-8743-db63da6fb1a0",
    mode: "merge",
    notes: "Relink all 3 vehicle photos.",
  },
  {
    key: "TRUCK_4",
    unitHint: "TRUCK 4",
    submissionId: "1017678e-87f0-4ebb-801e-19c248475294",
    mode: "merge",
    notes: "Relink the 3 confirmed objects (partial set).",
  },
  {
    key: "E2",
    unitHint: "E2",
    submissionId: "d4c80e35-26e6-4650-a2d8-b38fb426e6e2",
    mode: "merge",
    notes: "Merge missing finalInstall reference.",
  },
  {
    key: "T1",
    unitHint: "T1",
    submissionId: "7406d77e-06c6-4290-b734-e7b5c1db2ef2",
    mode: "report_extras",
    notes: "Report 2 extra objects and path validity; proposal still generated for review.",
  },
  {
    key: "TRUCK_8",
    unitHint: "TRUCK 8",
    submissionId: "ee6e0e1c-5fa4-43a7-9f6f-60ca2372d32c",
    mode: "report_extras",
    notes: "Report 1 extra object and path validity; proposal still generated for review.",
  },
];

const SKIP_UNITS = new Set(["T3", "T5", "T7"]);

const LABEL_BY_FIELD = {
  vehicleFront: "Vehicle front",
  vehicleSide: "Vehicle side",
  vehicleRear: "Vehicle rear",
  linxup_at_assetTrackerTag: "Asset Tracker — tag",
  linxup_at_powerConnection: "Asset Tracker — power connection",
  linxup_at_groundConnection: "Asset Tracker — ground connection",
  linxup_at_ignitionConnection: "Asset Tracker — ignition connection",
  linxup_at_finalInstall: "Asset Tracker — final install",
  linxup_vt_vehicleTrackerTag: "Vehicle Tracker — tag",
  linxup_vt_greenActivityLight: "Vehicle Tracker — green activity light",
  linxup_vt_installation: "Vehicle Tracker — installation",
  linxup_vt_finalInstall: "Vehicle Tracker — final installation",
  linxup_vt_powerConnection: "Vehicle Tracker — power connection",
  linxup_vt_groundConnection: "Vehicle Tracker — ground connection",
  linxup_vt_ignitionConnection: "Vehicle Tracker — ignition connection",
  linxup_lc_linxCamTag: "LinxCam — tag",
  linxup_lc_greenActivityLight: "LinxCam — green activity light",
  linxup_lc_installation: "LinxCam — installation",
  linxup_lc_finalInstall: "LinxCam — final installation",
  linxup_lc_powerConnection: "LinxCam — power connection",
  linxup_lc_groundConnection: "LinxCam — ground connection",
  linxup_lc_ignitionConnection: "LinxCam — ignition connection",
};

const VALID_GROUPS = new Set(["vac4", "vehicle", "ppd", "cp4", "linxup"]);

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

function getExistingUploads(payload) {
  const p = payload || {};
  const a = Array.isArray(p.photoUploads) ? p.photoUploads : [];
  const b = Array.isArray(p.photoSummary?.photoUploads) ? p.photoSummary.photoUploads : [];
  // Prefer top-level; still include summary-only paths for merge awareness
  const byPath = new Map();
  for (const item of [...a, ...b]) {
    const sp = String(item?.storagePath || "").trim();
    if (!sp || byPath.has(sp)) continue;
    byPath.set(sp, item);
  }
  return [...byPath.values()];
}

function inferFromPath(storagePath) {
  const parts = storagePath.split("/").filter(Boolean);
  // expected: submissionId / group / fieldName / filename
  if (parts.length < 4) {
    return {
      valid: false,
      reason: `Path depth ${parts.length} (need 4: submissionId/group/fieldName/filename)`,
      group: parts[1] || null,
      fieldName: parts[2] || null,
      filename: parts[parts.length - 1] || null,
    };
  }
  const group = parts[1];
  const fieldName = parts[2];
  const filename = parts.slice(3).join("/");
  if (!VALID_GROUPS.has(group)) {
    return { valid: false, reason: `Unknown group "${group}"`, group, fieldName, filename };
  }
  const label = LABEL_BY_FIELD[fieldName];
  if (!label && group === "linxup") {
    return {
      valid: false,
      reason: `Unknown LinxUp fieldName "${fieldName}"`,
      group,
      fieldName,
      filename,
    };
  }
  if (!label && group === "vehicle" && !["vehicleFront", "vehicleSide", "vehicleRear"].includes(fieldName)) {
    return { valid: false, reason: `Unknown vehicle fieldName "${fieldName}"`, group, fieldName, filename };
  }
  return {
    valid: true,
    reason: null,
    group,
    fieldName,
    filename,
    label: label || fieldName,
  };
}

async function listAllObjects(sb, submissionId) {
  const files = [];
  async function walk(prefix, depth) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`list(${prefix}): ${error.message}`);
    for (const entry of data || []) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      const isFile = !!entry.metadata;
      if (isFile) {
        files.push({
          storagePath: full,
          name: entry.name,
          size: entry.metadata?.size ?? null,
          created_at: entry.created_at || null,
          updated_at: entry.updated_at || null,
          contentType: entry.metadata?.mimetype || null,
        });
      } else if (depth < 5) {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(submissionId, 0);
  return files;
}

function buildProposedEntry(obj, publicUrl) {
  const inferred = inferFromPath(obj.storagePath);
  if (!inferred.valid) {
    return { ok: false, inferred, obj };
  }
  return {
    ok: true,
    inferred,
    entry: {
      fieldName: inferred.fieldName,
      group: inferred.group,
      label: inferred.label,
      filename: inferred.filename.replace(/^\d+-/, "") || inferred.filename,
      storagePath: obj.storagePath,
      publicUrl,
      uploadedAt: obj.created_at || obj.updated_at || new Date().toISOString(),
    },
  };
}

function completenessHint(unitKey, formId, merged) {
  const fields = new Set(merged.map((m) => m.fieldName));
  const hasVehicle = fields.has("vehicleFront") && fields.has("vehicleSide");
  if (unitKey === "TRUCK_9") {
    return {
      appears: hasVehicle && merged.length >= 3 ? "partial_vehicle_only" : "partial",
      detail: "Vehicle photos only in Storage; LinxUp device photos not present under this submission_id.",
    };
  }
  if (unitKey === "TRUCK_4") {
    return {
      appears: "partial",
      detail: "Only vehicleSide, vehicleRear, and one linxup_lc_linxCamTag object found under this submission_id.",
    };
  }
  if (unitKey === "S1") {
    const needed = [
      "vehicleFront",
      "vehicleSide",
      "linxup_at_powerConnection",
      "linxup_at_groundConnection",
      "linxup_at_ignitionConnection",
      "linxup_at_finalInstall",
    ];
    const missing = needed.filter((f) => !fields.has(f));
    return {
      appears: missing.length === 0 ? "complete_for_known_storage" : "partial",
      detail: missing.length ? `Still missing fields: ${missing.join(", ")}` : "All known Storage objects under S1 are represented.",
    };
  }
  if (unitKey === "E2") {
    return {
      appears: fields.has("linxup_at_finalInstall") ? "complete_for_known_storage" : "partial",
      detail: fields.has("linxup_at_finalInstall")
        ? "finalInstall included after merge."
        : "finalInstall still missing after proposal.",
    };
  }
  return {
    appears: "report_only",
    detail: `Form ${formId || "unknown"}; extras reported for review.`,
  };
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

fs.mkdirSync(OUT_DIR, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  mode: "DRY_RUN_NO_WRITES",
  bucket: BUCKET,
  projectId: PROJECT_ID,
  drafts: [],
  truck2Truck6Unlinked: null,
  permanentFixOutline: null,
};

const patches = {
  generatedAt: new Date().toISOString(),
  warning: "DRY RUN ONLY — do not apply until explicitly approved. Execution must backup payload first.",
  patches: [],
};

for (const target of TARGETS) {
  const { data: draft, error } = await sb
    .from("job_card_drafts")
    .select("submission_id, customer, unit_number, updated_at, created_at, company_id, project_id, payload")
    .eq("submission_id", target.submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!draft) {
    report.drafts.push({ key: target.key, error: "Draft row not found", submissionId: target.submissionId });
    continue;
  }
  if (SKIP_UNITS.has(String(draft.unit_number || "").trim())) {
    report.drafts.push({ key: target.key, skipped: true, reason: "In skip list", unit: draft.unit_number });
    continue;
  }

  const existing = getExistingUploads(draft.payload);
  const existingPaths = new Set(existing.map((e) => String(e.storagePath || "").trim()).filter(Boolean));
  const storageObjects = await listAllObjects(sb, target.submissionId);

  const proposedAdds = [];
  const invalidObjects = [];
  const alreadyPresent = [];
  const ambiguous = [];

  // Detect duplicate filenames under same field (multiple uploads)
  const byField = new Map();
  for (const obj of storageObjects) {
    const inferred = inferFromPath(obj.storagePath);
    const key = `${inferred.group || "?"}/${inferred.fieldName || "?"}`;
    if (!byField.has(key)) byField.set(key, []);
    byField.get(key).push(obj);
  }
  for (const [fieldKey, objs] of byField) {
    if (objs.length > 1) {
      ambiguous.push({
        fieldKey,
        count: objs.length,
        paths: objs.map((o) => o.storagePath),
        note: "Multiple objects under same field — merge keeps ALL unique storagePaths (no deletion).",
      });
    }
  }

  for (const obj of storageObjects) {
    if (existingPaths.has(obj.storagePath)) {
      alreadyPresent.push(obj.storagePath);
      continue;
    }
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(obj.storagePath);
    const publicUrl = pub?.publicUrl || "";
    const built = buildProposedEntry(obj, publicUrl);
    if (!built.ok) {
      invalidObjects.push({
        storagePath: obj.storagePath,
        reason: built.inferred.reason,
        group: built.inferred.group,
        fieldName: built.inferred.fieldName,
      });
      continue;
    }
    proposedAdds.push(built.entry);
  }

  const merged = [...existing];
  const mergedPaths = new Set(existingPaths);
  for (const add of proposedAdds) {
    if (mergedPaths.has(add.storagePath)) continue;
    mergedPaths.add(add.storagePath);
    merged.push(add);
  }

  const formId = draft.payload?.formId || draft.payload?.hardwareSelection?.primary || "";
  const completeness = completenessHint(target.key, formId, merged);

  const draftReport = {
    key: target.key,
    unit: draft.unit_number,
    customer: draft.customer,
    submissionId: draft.submission_id,
    companyId: draft.company_id,
    projectId: draft.project_id,
    updatedAt: draft.updated_at,
    formId,
    mode: target.mode,
    notes: target.notes,
    currentReferenceCount: existing.length,
    storageObjectCount: storageObjects.length,
    existingReferences: existing.map((e) => ({
      storagePath: e.storagePath,
      group: e.group,
      fieldName: e.fieldName,
      filename: e.filename,
    })),
    storageObjects: storageObjects.map((o) => ({
      storagePath: o.storagePath,
      size: o.size,
      created_at: o.created_at,
      ...inferFromPath(o.storagePath),
    })),
    proposedAddedReferences: proposedAdds,
    alreadyPresentCount: alreadyPresent.length,
    invalidObjects,
    ambiguousOrDuplicateFieldFolders: ambiguous,
    finalMergedReferenceCount: merged.length,
    completeness,
  };
  report.drafts.push(draftReport);

  // Proposed patch: only photoUploads (+ mirror into photoSummary.photoUploads if that object exists)
  const nextPayload = structuredClone(draft.payload || {});
  nextPayload.photoUploads = merged;
  if (nextPayload.photoSummary && typeof nextPayload.photoSummary === "object") {
    nextPayload.photoSummary.photoUploads = merged;
  } else {
    nextPayload.photoSummary = {
      ...(nextPayload.photoSummary || {}),
      photoUploads: merged,
    };
  }

  patches.patches.push({
    key: target.key,
    unit: draft.unit_number,
    submission_id: draft.submission_id,
    execute: false,
    operation: "UPDATE job_card_drafts SET payload = $nextPayload WHERE submission_id = $id",
    addedCount: proposedAdds.length,
    beforePhotoUploadsCount: existing.length,
    afterPhotoUploadsCount: merged.length,
    addedStoragePaths: proposedAdds.map((p) => p.storagePath),
    // Full payloads for review / Phase 2 backup
    beforePayload: draft.payload,
    afterPayload: nextPayload,
  });
}

// TRUCK 2 / TRUCK 6 — do not guess; list same-day unlinked folders
const dayStart = "2026-07-11T00:00:00.000Z";
const dayEnd = "2026-07-12T23:59:59.999Z";

const { data: allDrafts } = await sb
  .from("job_card_drafts")
  .select("submission_id, unit_number, customer, updated_at, payload")
  .eq("project_id", PROJECT_ID);

const draftIds = new Set((allDrafts || []).map((d) => d.submission_id));
const { data: submissions } = await sb
  .from("job_card_submissions")
  .select("submission_id")
  .gte("created_at", dayStart)
  .lte("created_at", dayEnd);
const submittedIds = new Set((submissions || []).map((s) => s.submission_id));

const truck2 = (allDrafts || []).find((d) => String(d.unit_number).trim().toUpperCase() === "TRUCK 2");
const truck6 = (allDrafts || []).find((d) => String(d.unit_number).trim().toUpperCase() === "TRUCK 6");

const { data: top } = await sb.storage.from(BUCKET).list("", { limit: 1000 });
const unlinkedSameDay = [];

for (const entry of top || []) {
  if (entry.metadata) continue;
  if (!/^[0-9a-f-]{30,}$/i.test(entry.name)) continue;
  if (draftIds.has(entry.name) || submittedIds.has(entry.name)) continue;
  // Skip known S1 timeout duplicate unless we still list it for transparency
  const files = await listAllObjects(sb, entry.name);
  if (!files.length) continue;
  const newest = files.map((f) => f.created_at || "").sort().reverse()[0] || null;
  if (!newest || newest < dayStart || newest > dayEnd) continue;

  const withPreviews = [];
  for (const f of files) {
    const { data: signed, error: signErr } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(f.storagePath, SIGNED_URL_TTL_SEC);
    withPreviews.push({
      storagePath: f.storagePath,
      size: f.size,
      created_at: f.created_at,
      inferred: inferFromPath(f.storagePath),
      previewSignedUrl: signErr ? null : signed?.signedUrl || null,
      previewError: signErr ? signErr.message : null,
    });
  }

  unlinkedSameDay.push({
    folderSubmissionId: entry.name,
    fileCount: files.length,
    newestCreated: newest,
    knownNote:
      entry.name === "34204621-807e-4ece-abc1-7a41397bb80f"
        ? "Identified as S1 timeout duplicate vehicle photos (same bytes/names as S1). Do not attach to TRUCK 2/6."
        : "Unlinked — requires manual identification. Do not auto-attach to TRUCK 2/6.",
    files: withPreviews,
  });
}

report.truck2Truck6Unlinked = {
  truck2: truck2
    ? {
        submissionId: truck2.submission_id,
        unit: truck2.unit_number,
        updatedAt: truck2.updated_at,
        photoUploads: getExistingUploads(truck2.payload).length,
        storageUnderDraftId: (await listAllObjects(sb, truck2.submission_id)).length,
        status: "no_storage_under_current_draft_id — do not guess",
      }
    : null,
  truck6: truck6
    ? {
        submissionId: truck6.submission_id,
        unit: truck6.unit_number,
        updatedAt: truck6.updated_at,
        photoUploads: getExistingUploads(truck6.payload).length,
        storageUnderDraftId: (await listAllObjects(sb, truck6.submission_id)).length,
        status: "no_storage_under_current_draft_id — do not guess",
      }
    : null,
  sameDayUnlinkedFolders: unlinkedSameDay,
};

report.permanentFixOutline = {
  status: "proposal_only_not_implemented",
  requirements: [
    "Manual Save Draft merges existing cloud photoUploads by storagePath before write",
    "Never overwrite durable refs with empty/partial in-memory arrays",
    "Wait for pending uploads; verify saved row before success UI",
    "Autosave must not clear cloud photo references",
    "Second-device resume+save preserves all existing refs",
    "Per-photo uploading/saved/failed UI",
    "Regression tests for save/resume/second-device/partial memory/LinxUp",
  ],
};

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(OUT_DIR, `dry-run-report-${stamp}.json`);
const patchPath = path.join(OUT_DIR, `dry-run-patches-${stamp}.json`);
const markdownPath = path.join(OUT_DIR, `dry-run-summary-${stamp}.md`);

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.writeFileSync(patchPath, JSON.stringify(patches, null, 2));

let md = `# Draft photo recovery dry-run\n\nGenerated: ${report.generatedAt}\n\n**NO WRITES PERFORMED.**\n\n`;
for (const d of report.drafts) {
  if (d.error || d.skipped) {
    md += `## ${d.key}\n\n${d.error || d.reason}\n\n`;
    continue;
  }
  md += `## ${d.unit} (${d.key})\n\n`;
  md += `- submission_id: \`${d.submissionId}\`\n`;
  md += `- formId: \`${d.formId}\`\n`;
  md += `- current refs: **${d.currentReferenceCount}**\n`;
  md += `- storage objects: **${d.storageObjectCount}**\n`;
  md += `- proposed adds: **${d.proposedAddedReferences.length}**\n`;
  md += `- final merged count: **${d.finalMergedReferenceCount}**\n`;
  md += `- completeness: **${d.completeness.appears}** — ${d.completeness.detail}\n`;
  md += `- notes: ${d.notes}\n\n`;
  md += `### Existing references\n\n`;
  for (const e of d.existingReferences) md += `- \`${e.storagePath}\` (${e.group}/${e.fieldName})\n`;
  if (!d.existingReferences.length) md += `- _(none)_\n`;
  md += `\n### Proposed added references\n\n`;
  for (const e of d.proposedAddedReferences) md += `- \`${e.storagePath}\` (${e.group}/${e.fieldName})\n`;
  if (!d.proposedAddedReferences.length) md += `- _(none — already complete or report-only with no missing paths)_\n`;
  if (d.ambiguousOrDuplicateFieldFolders?.length) {
    md += `\n### Ambiguous / multi-object fields\n\n`;
    for (const a of d.ambiguousOrDuplicateFieldFolders) {
      md += `- ${a.fieldKey} ×${a.count}: ${a.paths.map((p) => `\`${p}\``).join(", ")}\n`;
    }
  }
  if (d.invalidObjects?.length) {
    md += `\n### Invalid paths\n\n`;
    for (const i of d.invalidObjects) md += `- \`${i.storagePath}\` — ${i.reason}\n`;
  }
  md += `\n`;
}

md += `## TRUCK 2 / TRUCK 6 (no guessing)\n\n`;
md += `- TRUCK 2: \`${report.truck2Truck6Unlinked.truck2?.submissionId}\` — storage under draft: ${report.truck2Truck6Unlinked.truck2?.storageUnderDraftId}\n`;
md += `- TRUCK 6: \`${report.truck2Truck6Unlinked.truck6?.submissionId}\` — storage under draft: ${report.truck2Truck6Unlinked.truck6?.storageUnderDraftId}\n\n`;
md += `### Same-day unlinked folders\n\n`;
for (const f of report.truck2Truck6Unlinked.sameDayUnlinkedFolders) {
  md += `#### \`${f.folderSubmissionId}\` (${f.fileCount} files, newest ${f.newestCreated})\n\n`;
  md += `${f.knownNote}\n\n`;
  for (const file of f.files) {
    md += `- \`${file.storagePath}\` (${file.size} bytes, ${file.created_at})\n`;
    if (file.previewSignedUrl) md += `  - preview: ${file.previewSignedUrl}\n`;
  }
  md += `\n`;
}

md += `## Phase 2 / Phase 3\n\nPhase 2 execution is **blocked** until you approve this dry-run.\n\nPhase 3 permanent fix is outlined in the JSON report under \`permanentFixOutline\` — not implemented in this run.\n`;

fs.writeFileSync(markdownPath, md);

// Ensure output dir is gitignored
const gi = fs.existsSync(".gitignore") ? fs.readFileSync(".gitignore", "utf8") : "";
if (!gi.includes("recovery-dry-run-output")) {
  fs.appendFileSync(".gitignore", "\n# Local draft photo recovery dry-run artifacts (may contain signed URLs)\nrecovery-dry-run-output/\n");
}

console.log(
  JSON.stringify(
    {
      status: "DRY_RUN_COMPLETE",
      reportPath,
      patchPath,
      markdownPath,
      draftSummaries: report.drafts.map((d) =>
        d.error || d.skipped
          ? d
          : {
              key: d.key,
              unit: d.unit,
              current: d.currentReferenceCount,
              storage: d.storageObjectCount,
              proposedAdds: d.proposedAddedReferences.length,
              merged: d.finalMergedReferenceCount,
              completeness: d.completeness.appears,
            },
      ),
      unlinkedFolderCount: report.truck2Truck6Unlinked.sameDayUnlinkedFolders.length,
    },
    null,
    2,
  ),
);
