import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildEmailPhotoSections,
  renderPhotoSectionsHtml,
  renderPhotoSectionsText,
} from "./email-photo-sections.ts";

function contentIdForStoragePath(storagePath: string): string {
  const hash = createHash("sha256").update(storagePath).digest("hex").slice(0, 24);
  return `photo-${hash}`;
}

describe("email photo messaging", () => {
  const payload = {
    submissionId: "sub-e2",
    submissionTimestamp: "2026-01-15T12:00:00.000Z",
    status: "Submitted" as const,
    formId: "linxup_asset_tracker",
    submissionType: "linxup_asset_tracker",
    selectedSections: ["linxup_asset_tracker"],
    hardwareSelection: { primary: "linxup_asset_tracker", hasAdditional: "No", additional: [] },
    coreJobInfo: {
      customer: "Low Country Concrete",
      location: "Site",
      workOrder: "",
      serviceAppointment: "",
      unitNumber: "E2",
      equipmentMake: "",
      equipmentModel: "",
      equipmentSerial: "",
      installerName: "Nick",
    },
    linxup: {
      formId: "linxup_asset_tracker",
      submissionType: "linxup_asset_tracker",
      productLabel: "Asset Tracker",
      customer: "Low Country Concrete",
      location: "Site",
      primaryContact: "Janet",
      contactNumber: "",
      contactEmail: "",
      year: "2020",
      make: "Cat",
      model: "D6",
      serialVin: "VIN",
      assetNumber: "E2",
      vehicleType: "Heavy Equipment",
      hoursMiles: "100",
      powerConnectionDescription: "Red",
      groundConnectionDescription: "Black",
      ignitionConnectionDescription: "Blue",
    },
    photoUploads: [
      {
        fieldName: "vehicleFront",
        group: "vehicle",
        label: "Vehicle Front",
        filename: "img.jpg",
        storagePath: "e2/vehicle/front.jpg",
        publicUrl: "https://x.supabase.co/storage/v1/object/public/job-card-photos/e2/vehicle/front.jpg",
        originalBytes: 4_700_000,
        optimizedBytes: 515_000,
        attachmentDisplayName: "Low_Country_Concrete_E2_Vehicle_Front.jpg",
      },
    ],
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
      operatorPresenceInstalled: "",
      speedSenseInstalled: "",
      loadSenseInstalled: "",
      gpsInstalled: "",
      externalIndicatorInstalled: "",
      speedSenseDescription: "",
      speedSensePulseCount: "",
      loadSenseThresholds: "",
      redWireDescription: "",
      blackWireDescription: "",
      blueWireDescription: "",
      brownWireDescription: "",
      photoCounts: {},
      photoFileNames: {
        vacMounting: [],
        wirePath: [],
        redWire: [],
        blackWire: [],
        blueWire: [],
        brownWire: [],
        sensorHubMounting: [],
        speedSense: [],
        loadSense: [],
        gps: [],
        externalIndicator: [],
        purpleWire: [],
        relayAccess: [],
        impactSensor: [],
      },
      photoUrls: {
        vacMounting: [],
        wirePath: [],
        redWire: [],
        blackWire: [],
        blueWire: [],
        brownWire: [],
        sensorHubMounting: [],
        speedSense: [],
        loadSense: [],
        gps: [],
        externalIndicator: [],
        purpleWire: [],
        relayAccess: [],
        impactSensor: [],
      },
    },
  };

  it("preview has no orange warning and no optimize size notes", () => {
    const sections = buildEmailPhotoSections(payload);
    const html = renderPhotoSectionsHtml(sections, { mode: "preview" });
    assert.doesNotMatch(html, /could not be attached/i);
    assert.doesNotMatch(html, /failed to attach/i);
    assert.doesNotMatch(html, /Optimized /);
    assert.doesNotMatch(html, /optimized copy/i);
    assert.doesNotMatch(html, /4\.53MB|515KB/i);
  });

  it("successful cid render has no warning box", () => {
    const sections = buildEmailPhotoSections(payload);
    const cid = contentIdForStoragePath("e2/vehicle/front.jpg");
    const html = renderPhotoSectionsHtml(sections, {
      mode: "cid",
      cidByStoragePath: new Map([["e2/vehicle/front.jpg", cid]]),
    });
    assert.match(html, new RegExp(`cid:${cid}`));
    assert.doesNotMatch(html, /failed to attach/i);
    assert.doesNotMatch(html, /could not be attached/i);
    assert.doesNotMatch(html, /Optimized /);
    const text = renderPhotoSectionsText(sections);
    assert.doesNotMatch(text, /Optimized /);
    assert.doesNotMatch(text, /could not be attached/i);
  });

  it("failure banner appears only for real attachmentFailures", () => {
    const sections = buildEmailPhotoSections(payload);
    const html = renderPhotoSectionsHtml(sections, {
      mode: "cid",
      cidByStoragePath: new Map(),
      attachmentFailures: ["Vehicle Front (file.jpg): download failed"],
    });
    assert.match(html, /failed to attach/i);
    assert.match(html, /download failed/);
  });
});
