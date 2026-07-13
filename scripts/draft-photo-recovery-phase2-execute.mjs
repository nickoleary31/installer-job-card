/**
 * Phase 2 execution: merge approved photoUploads into job_card_drafts.
 * Targets: S1, E2, TRUCK 9, TRUCK 4 only.
 * Does NOT touch Storage objects.
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "job-card-photos";
const OUT_DIR = path.resolve("recovery-dry-run-output");
const APPROVED = [
  {
    key: "S1",
    unitHint: "S1",
    submissionId: "5a40bebb-6b3d-4db2-8793-9b496927a2c5",
    expectedFinalCount: 6,
  },
  {
    key: "E2",
    unitHint: "E2",
    submissionId: "d4c80e35-26e6-4650-a2d8-b38fb426e6e2",
    expectedFinalCount: 8,
  },
  {
    key: "TRUCK_9",
    unitHint: "TRUCK 9",
    submissionId: "8c050ce1-9af9-4654-8743-db63da6fb1a0",
    expectedFinalCount: 3,
  },
  {
    key: "TRUCK_4",
    unitHint: "TRUCK 4",
    submissionId: "1017678e-87f0-4ebb-801e-19c248475294",
    expectedFinalCount: 3,
  },
];

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
  if (parts.length < 4) return { valid: false, reason: "bad depth" };
  const group = parts[1];
  const fieldName = parts[2];
  const filename = parts.slice(3).join("/");
  if (!VALID_GROUPS.has(group)) return { valid: false, reason: `bad group ${group}` };
  const label = LABEL_BY_FIELD[fieldName];
  if (!label) return { valid: false, reason: `bad field ${fieldName}` };
  return { valid: true, group, fieldName, filename, label };
}

async function listAllObjects(sb, submissionId) {
  const files = [];
  async function walk(prefix, depth) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) throw new Error(`list(${prefix}): ${error.message}`);
    for (const entry of data || []) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.metadata) {
        files.push({
          storagePath: full,
          created_at: entry.created_at || null,
          updated_at: entry.updated_at || null,
        });
      } else if (depth < 5) {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(submissionId, 0);
  return files;
}

async function storagePathExists(sb, storagePath) {
  const parts = storagePath.split("/");
  const filename = parts.pop();
  const folder = parts.join("/");
  const { data, error } = await sb.storage.from(BUCKET).list(folder, { limit: 1000 });
  if (error) return { ok: false, error: error.message };
  const found = (data || []).some((e) => e.name === filename && e.metadata);
  return { ok: found };
}

function stripPhotoFields(payload) {
  const clone = structuredClone(payload || {});
  delete clone.photoUploads;
  if (clone.photoSummary && typeof clone.photoSummary === "object") {
    const ps = { ...clone.photoSummary };
    delete ps.photoUploads;
    // Also ignore URL mirrors that may be rebuilt from refs later; compare structural non-photo content carefully.
    // Keep vac/vehicle URL fields as-is for equality check of non-photo payload:
    clone.photoSummary = ps;
  }
  return clone;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(OUT_DIR, `phase2-backups-${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });

const executionReport = {
  executedAt: new Date().toISOString(),
  mode: "PHASE_2_EXECUTE_APPROVED_ONLY",
  targets: APPROVED.map((t) => t.key),
  results: [],
};

for (const target of APPROVED) {
  const result = {
    key: target.key,
    submissionId: target.submissionId,
    expectedFinalCount: target.expectedFinalCount,
    errors: [],
  };

  try {
    const { data: draft, error } = await sb
      .from("job_card_drafts")
      .select("submission_id, customer, unit_number, updated_at, payload, company_id, project_id")
      .eq("submission_id", target.submissionId)
      .maybeSingle();
    if (error) throw error;
    if (!draft) throw new Error("Draft row not found");

    result.unit = draft.unit_number;
    result.customer = draft.customer;
    result.updatedAtBefore = draft.updated_at;

    const backupPath = path.join(backupDir, `${target.key}-${target.submissionId}.json`);
    const backupPayload = {
      backedUpAt: new Date().toISOString(),
      submission_id: draft.submission_id,
      customer: draft.customer,
      unit_number: draft.unit_number,
      company_id: draft.company_id,
      project_id: draft.project_id,
      updated_at: draft.updated_at,
      payload: draft.payload,
    };
    fs.writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2));
    result.backupLocation = backupPath;

    const existing = getExistingUploads(draft.payload);
    const existingPaths = new Set(existing.map((e) => String(e.storagePath || "").trim()).filter(Boolean));
    const storageObjects = await listAllObjects(sb, target.submissionId);

    const proposedAdds = [];
    for (const obj of storageObjects) {
      if (existingPaths.has(obj.storagePath)) continue;
      const inferred = inferFromPath(obj.storagePath);
      if (!inferred.valid) {
        result.errors.push(`Skipped invalid path ${obj.storagePath}: ${inferred.reason}`);
        continue;
      }
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(obj.storagePath);
      proposedAdds.push({
        fieldName: inferred.fieldName,
        group: inferred.group,
        label: inferred.label,
        filename: inferred.filename.replace(/^\d+-/, "") || inferred.filename,
        storagePath: obj.storagePath,
        publicUrl: pub?.publicUrl || "",
        uploadedAt: obj.created_at || obj.updated_at || new Date().toISOString(),
      });
    }

    const merged = [...existing];
    const mergedPaths = new Set(existingPaths);
    for (const add of proposedAdds) {
      if (mergedPaths.has(add.storagePath)) continue;
      mergedPaths.add(add.storagePath);
      merged.push(add);
    }

    result.referencesBefore = existing.length;
    result.referencesAdded = proposedAdds.map((p) => p.storagePath);
    result.referencesAddedCount = proposedAdds.length;
    result.finalReferenceCountLocal = merged.length;

    if (merged.length !== target.expectedFinalCount) {
      throw new Error(
        `Merged count ${merged.length} !== expected ${target.expectedFinalCount}. Aborting update for this draft.`,
      );
    }

    const nextPayload = structuredClone(draft.payload || {});
    nextPayload.photoUploads = merged;
    if (nextPayload.photoSummary && typeof nextPayload.photoSummary === "object") {
      nextPayload.photoSummary = { ...nextPayload.photoSummary, photoUploads: merged };
    } else {
      nextPayload.photoSummary = { ...(nextPayload.photoSummary || {}), photoUploads: merged };
    }

    // Non-photo payload must remain equal (ignoring photoUploads mirrors)
    if (!deepEqual(stripPhotoFields(draft.payload), stripPhotoFields(nextPayload))) {
      throw new Error("Non-photo payload would change — aborting.");
    }

    const updatedAt = new Date().toISOString();
    const { error: updateError } = await sb
      .from("job_card_drafts")
      .update({
        payload: nextPayload,
        updated_at: updatedAt,
      })
      .eq("submission_id", target.submissionId);
    if (updateError) throw updateError;

    // Re-read and verify
    const { data: after, error: afterErr } = await sb
      .from("job_card_drafts")
      .select("submission_id, unit_number, updated_at, payload")
      .eq("submission_id", target.submissionId)
      .maybeSingle();
    if (afterErr) throw afterErr;
    if (!after) throw new Error("Re-read failed: row missing");

    const afterUploads = getExistingUploads(after.payload);
    result.finalReferenceCount = afterUploads.length;
    result.updatedAtAfter = after.updated_at;

    const countOk = afterUploads.length === target.expectedFinalCount;
    const pathChecks = [];
    for (const u of afterUploads) {
      const check = await storagePathExists(sb, u.storagePath);
      pathChecks.push({ storagePath: u.storagePath, exists: check.ok, error: check.error || null });
    }
    const allPathsExist = pathChecks.every((p) => p.exists);
    const nonPhotoUnchanged = deepEqual(stripPhotoFields(draft.payload), stripPhotoFields(after.payload));
    const allAddedPresent = proposedAdds.every((a) =>
      afterUploads.some((u) => u.storagePath === a.storagePath),
    );
    const existingPreserved = existing.every((e) =>
      afterUploads.some((u) => u.storagePath === e.storagePath),
    );

    result.pathChecks = pathChecks;
    result.verification = {
      expectedCount: countOk,
      allStoragePathsExist: allPathsExist,
      nonPhotoPayloadUnchanged: nonPhotoUnchanged,
      allAddedPresent,
      existingPreserved,
      passed: countOk && allPathsExist && nonPhotoUnchanged && allAddedPresent && existingPreserved,
    };

    if (!result.verification.passed) {
      result.errors.push("Post-update verification failed — see verification object. Backup retained for restore.");
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
    result.verification = { passed: false };
  }

  executionReport.results.push(result);
}

const reportPath = path.join(OUT_DIR, `phase2-execution-report-${stamp}.json`);
const mdPath = path.join(OUT_DIR, `phase2-execution-report-${stamp}.md`);
fs.writeFileSync(reportPath, JSON.stringify(executionReport, null, 2));

let md = `# Phase 2 recovery execution report\n\nExecuted: ${executionReport.executedAt}\n\nStorage objects: **untouched**\n\n`;
for (const r of executionReport.results) {
  md += `## ${r.unit || r.key}\n\n`;
  md += `- submission_id: \`${r.submissionId}\`\n`;
  md += `- backup: \`${r.backupLocation || "n/a"}\`\n`;
  md += `- refs before: ${r.referencesBefore ?? "?"}\n`;
  md += `- refs added (${r.referencesAddedCount ?? 0}):\n`;
  for (const p of r.referencesAdded || []) md += `  - \`${p}\`\n`;
  md += `- final reference count: **${r.finalReferenceCount ?? "n/a"}** (expected ${r.expectedFinalCount})\n`;
  md += `- verification: **${r.verification?.passed ? "PASSED" : "FAILED"}**\n`;
  if (r.verification) {
    md += `  - expectedCount: ${r.verification.expectedCount}\n`;
    md += `  - allStoragePathsExist: ${r.verification.allStoragePathsExist}\n`;
    md += `  - nonPhotoPayloadUnchanged: ${r.verification.nonPhotoPayloadUnchanged}\n`;
    md += `  - allAddedPresent: ${r.verification.allAddedPresent}\n`;
    md += `  - existingPreserved: ${r.verification.existingPreserved}\n`;
  }
  if (r.errors?.length) {
    md += `- errors:\n`;
    for (const e of r.errors) md += `  - ${e}\n`;
  }
  md += `\n`;
}
md += `## Next step\n\nVerify all four drafts from a second device. Do not implement permanent fix until confirmed.\n`;
fs.writeFileSync(mdPath, md);

console.log(
  JSON.stringify(
    {
      reportPath,
      mdPath,
      backupDir,
      summaries: executionReport.results.map((r) => ({
        unit: r.unit || r.key,
        submissionId: r.submissionId,
        finalCount: r.finalReferenceCount,
        expected: r.expectedFinalCount,
        passed: r.verification?.passed,
        errors: r.errors,
      })),
    },
    null,
    2,
  ),
);
