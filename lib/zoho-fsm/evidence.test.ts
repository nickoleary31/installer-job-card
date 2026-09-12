import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompletedAsset, buildEvidenceResponse } from "./evidence.ts";
import type { JobCardSubmissionPayload } from "../job-card-submission.ts";

function payload(overrides: Partial<JobCardSubmissionPayload> = {}): JobCardSubmissionPayload {
  return {
    submissionId: "sub-1",
    submissionTimestamp: "2026-09-11T00:00:00.000Z",
    status: "Submitted",
    coreJobInfo: {
      customer: "Shoppas",
      location: "Roanoke, VA",
      workOrder: "WO21",
      serviceAppointment: "AP-15",
      unitNumber: "FL-104",
      equipmentMake: "Toyota",
      equipmentModel: "8FGU25",
      equipmentSerial: "TOY-88421",
      installerName: "Nick O'Leary",
    },
    hardwareSelection: { primary: "", hasAdditional: "No", additional: [] },
    selectedSections: [],
    photoUploads: [],
    vac4: {
      vehicleType: "",
      otherVehicleType: "",
      driveType: "",
      vehicleVoltage: "",
      vehicleVoltageOther: "",
      clientApproval: "",
      hourMeter: "",
      sensorHubInstalled: "",
      liftSenseInstalled: "",
      speedSenseInstalled: "",
      loadSenseInstalled: "",
      gpsInstalled: "",
      externalIndicatorInstalled: "",
      speedSenseDescription: "",
      speedSensePulseCount: "",
    } as JobCardSubmissionPayload["vac4"],
    ...overrides,
  } as JobCardSubmissionPayload;
}

describe("zoho-fsm evidence", () => {
  describe("buildCompletedAsset", () => {
    it("exposes submissionId/unitNumber/createdAt from the row, never a last-revised timestamp (job_card_submissions has no updated_at column)", () => {
      const asset = buildCompletedAsset({
        submissionId: "sub-1",
        unitNumber: "FL-104",
        createdAt: "2026-09-01T12:00:00.000Z",
        payload: payload(),
      });
      assert.equal(asset.submissionId, "sub-1");
      assert.equal(asset.unitNumber, "FL-104");
      assert.equal(asset.createdAt, "2026-09-01T12:00:00.000Z");
    });

    it("exposes equipmentSerial (CoreJobFields) as the physical customer-asset identifier, trimmed", () => {
      const asset = buildCompletedAsset({
        submissionId: "sub-1",
        unitNumber: "FL-104",
        createdAt: "2026-09-01T12:00:00.000Z",
        payload: payload({ coreJobInfo: { ...payload().coreJobInfo, equipmentSerial: "  TOY-88421  " } }),
      });
      assert.equal(asset.assetIdentifiers.equipmentSerial, "TOY-88421");
    });

    it("maps equipmentSerial to null when blank, rather than an empty string", () => {
      const asset = buildCompletedAsset({
        submissionId: "sub-1",
        unitNumber: null,
        createdAt: "2026-09-01T12:00:00.000Z",
        payload: payload({ coreJobInfo: { ...payload().coreJobInfo, equipmentSerial: "   " } }),
      });
      assert.equal(asset.assetIdentifiers.equipmentSerial, null);
    });

    it("degrades gracefully to an empty identifiers/installedProducts shape when payload is null", () => {
      const asset = buildCompletedAsset({
        submissionId: "sub-1",
        unitNumber: "FL-104",
        createdAt: "2026-09-01T12:00:00.000Z",
        payload: null,
      });
      assert.equal(asset.assetIdentifiers.equipmentSerial, null);
      assert.deepEqual(asset.installedProducts, []);
    });

    it("derives installedProducts from the CURRENT payload's installedProductSystems, via the existing canonical normalizeInstalledProductSystems() helper", () => {
      const asset = buildCompletedAsset({
        submissionId: "sub-1",
        unitNumber: "FL-104",
        createdAt: "2026-09-01T12:00:00.000Z",
        payload: payload({
          installedProductSystems: [
            {
              id: "sys-1",
              companyProductId: null,
              productKey: "blaxtair_mr260",
              displayLabel: "MR260 (2 Cameras)",
              hardwareProfileId: "blaxtair_5_camera_label",
              detectedHardwareProfileId: null,
              installationVariant: null,
              technicianConfirmed: true,
              detectionConfidence: null,
              detectionOverridden: false,
              extractionSource: null,
              manualFallbackReason: null,
              components: [
                { id: "c1", componentType: "camera", componentLabel: "Camera 1", slotKey: "camera_1", hardwareProfileId: null, detectedHardwareProfileId: null, identifiers: { serialNumber: "CAM-1" }, labelPhoto: null, mountingLocation: null, viewDirection: null, installPhotos: [], extractionSource: null, detectionConfidence: null, technicianConfirmed: true, detectionOverridden: false, identifierEdits: [], manualFallbackReason: null, installDetails: {}, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
                { id: "c2", componentType: "camera", componentLabel: "Camera 2", slotKey: "camera_2", hardwareProfileId: null, detectedHardwareProfileId: null, identifiers: { serialNumber: "CAM-2" }, labelPhoto: null, mountingLocation: null, viewDirection: null, installPhotos: [], extractionSource: null, detectionConfidence: null, technicianConfirmed: true, detectionOverridden: false, identifierEdits: [], manualFallbackReason: null, installDetails: {}, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
              ],
              installDetails: {},
              installPhotos: [],
              installGuide: null,
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-01T00:00:00.000Z",
            },
          ],
        }),
      });
      assert.deepEqual(asset.installedProducts, [
        { productKey: "blaxtair_mr260", displayLabel: "MR260 (2 Cameras)", componentCount: 2 },
      ]);
    });

    it("never substitutes an installed component's own device serial number for the physical customer-asset identity", () => {
      const asset = buildCompletedAsset({
        submissionId: "sub-1",
        unitNumber: "FL-104",
        createdAt: "2026-09-01T12:00:00.000Z",
        payload: payload({
          coreJobInfo: { ...payload().coreJobInfo, equipmentSerial: "TOY-88421" },
          installedProductSystems: [
            {
              id: "sys-1",
              companyProductId: null,
              productKey: "blaxtair_mr260",
              displayLabel: "MR260",
              hardwareProfileId: "blaxtair_5_camera_label",
              detectedHardwareProfileId: null,
              installationVariant: null,
              technicianConfirmed: true,
              detectionConfidence: null,
              detectionOverridden: false,
              extractionSource: null,
              manualFallbackReason: null,
              components: [
                { id: "c1", componentType: "camera", componentLabel: "Camera 1", slotKey: "camera_1", hardwareProfileId: null, detectedHardwareProfileId: null, identifiers: { serialNumber: "CAM-SERIAL-NOT-THE-ASSET" }, labelPhoto: null, mountingLocation: null, viewDirection: null, installPhotos: [], extractionSource: null, detectionConfidence: null, technicianConfirmed: true, detectionOverridden: false, identifierEdits: [], manualFallbackReason: null, installDetails: {}, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
              ],
              installDetails: {},
              installPhotos: [],
              installGuide: null,
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-01T00:00:00.000Z",
            },
          ],
        }),
      });
      // The physical customer asset's identity comes only from coreJobInfo.equipmentSerial.
      assert.equal(asset.assetIdentifiers.equipmentSerial, "TOY-88421");
      assert.notEqual(asset.assetIdentifiers.equipmentSerial, "CAM-SERIAL-NOT-THE-ASSET");
      // The installed component's own device serial lives only under installedProducts, never
      // surfaced as (or merged into) assetIdentifiers.
      assert.equal(JSON.stringify(asset.installedProducts).includes("CAM-SERIAL-NOT-THE-ASSET"), false);
    });
  });

  describe("buildEvidenceResponse", () => {
    it("completedAssetCount equals the current job_card_submissions row count for the project — a plain count, matching the project list screen's own completedSubmissionCount logic", () => {
      const response = buildEvidenceResponse({
        zohoServiceAppointmentId: "sa-15",
        projectId: "project-1",
        submissions: [
          { submissionId: "sub-1", unitNumber: "FL-104", createdAt: "2026-09-01T00:00:00.000Z", payload: null },
          { submissionId: "sub-2", unitNumber: "FL-105", createdAt: "2026-09-02T00:00:00.000Z", payload: null },
        ],
        pendingDraftCount: 0,
      });
      assert.equal(response.completedAssetCount, 2);
      assert.equal(response.completedAssets.length, 2);
    });

    it("does not deduplicate by unitNumber — two distinct submissionIds always count as two completed assets, even with the same unitNumber (the narrower 'started a new job card instead of editing' case is explicitly left for a future orchestrator to review, not solved here)", () => {
      const response = buildEvidenceResponse({
        zohoServiceAppointmentId: "sa-15",
        projectId: "project-1",
        submissions: [
          { submissionId: "sub-1", unitNumber: "FL-104", createdAt: "2026-09-01T00:00:00.000Z", payload: null },
          { submissionId: "sub-2", unitNumber: "FL-104", createdAt: "2026-09-02T00:00:00.000Z", payload: null },
        ],
        pendingDraftCount: 0,
      });
      assert.equal(response.completedAssetCount, 2);
    });

    it("a supported revision (same submissionId, updated payload) requires no additional dedup logic here — the caller only ever supplies one row per submission_id, since an edit UPDATEs in place rather than inserting a new row", () => {
      // Simulates what the DB already guarantees (see app/page.tsx persistSubmittedJobCard):
      // a revision never produces a second row for the same submission_id, so a single row per
      // id is exactly what fetchZohoFsmEvidence's query naturally returns.
      const response = buildEvidenceResponse({
        zohoServiceAppointmentId: "sa-15",
        projectId: "project-1",
        submissions: [
          { submissionId: "sub-1", unitNumber: "FL-104", createdAt: "2026-09-01T00:00:00.000Z", payload: payload({ coreJobInfo: { ...payload().coreJobInfo, equipmentSerial: "REVISED-SERIAL" } }) },
        ],
        pendingDraftCount: 0,
      });
      assert.equal(response.completedAssetCount, 1);
      // The latest (revised) payload content is what's reflected — never a stale pre-revision copy.
      assert.equal(response.completedAssets[0].assetIdentifiers.equipmentSerial, "REVISED-SERIAL");
    });

    it("passes through pendingDraftCount and always sets pendingDraftCountScope to 'server_only'", () => {
      const response = buildEvidenceResponse({
        zohoServiceAppointmentId: "sa-15",
        projectId: "project-1",
        submissions: [],
        pendingDraftCount: 3,
      });
      assert.equal(response.pendingDraftCount, 3);
      assert.equal(response.pendingDraftCountScope, "server_only");
    });

    it("echoes back the identifying zohoServiceAppointmentId/projectId unchanged", () => {
      const response = buildEvidenceResponse({
        zohoServiceAppointmentId: "sa-99",
        projectId: "project-99",
        submissions: [],
        pendingDraftCount: 0,
      });
      assert.equal(response.zohoServiceAppointmentId, "sa-99");
      assert.equal(response.projectId, "project-99");
    });
  });
});
