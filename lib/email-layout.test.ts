import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildEmailPhotoSections,
  renderPhotoSectionsHtml,
} from "./email-photo-sections.ts";

function contentIdForStoragePath(storagePath: string): string {
  const hash = createHash("sha256").update(storagePath).digest("hex").slice(0, 24);
  return `photo-${hash}`;
}

describe("email layout + CID photos", () => {
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
      primaryContact: "Janet Ferguson",
      contactNumber: "",
      contactEmail: "janet@lowcountryconcrete.net",
      year: "2020",
      make: "Cat",
      model: "D6",
      serialVin: "VIN",
      assetNumber: "E2",
      vehicleType: "Heavy Equipment",
      hoursMiles: "100",
      powerConnectionDescription: "Red to battery",
      groundConnectionDescription: "Black to frame",
      ignitionConnectionDescription: "Blue to ignition",
    },
    photoUploads: [
      {
        fieldName: "vehicleFront",
        group: "vehicle",
        label: "Vehicle Front",
        filename: "img.jpg",
        storagePath: "e2/vehicle/front.jpg",
        publicUrl: "https://x.supabase.co/storage/v1/object/public/job-card-photos/e2/vehicle/front.jpg",
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

  it("photo html uses cid refs without storage urls", () => {
    const sections = buildEmailPhotoSections(payload);
    const cid = contentIdForStoragePath("e2/vehicle/front.jpg");
    const html = renderPhotoSectionsHtml(sections, {
      mode: "cid",
      cidByStoragePath: new Map([["e2/vehicle/front.jpg", cid]]),
    });
    assert.match(html, /Vehicle Pictures/);
    assert.match(html, new RegExp(`cid:${cid}`));
    assert.doesNotMatch(html, /supabase\.co\/storage/i);
  });

  it("photo section headings are friendly", () => {
    const sections = buildEmailPhotoSections(payload);
    assert.equal(sections[0]?.heading, "Vehicle Pictures");
  });
});
