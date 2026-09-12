import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeZohoPrefillIntoCoreJob, stripRecognizedZohoNumberPrefix } from "./core-job-prefill.ts";
import type { CoreJobFields } from "../job-card-submission.ts";
import { UNLINKED_PROJECT_INFO, type ZohoProjectInfoViewModel } from "./project-info.ts";

function emptyCoreJob(overrides: Partial<CoreJobFields> = {}): CoreJobFields {
  return {
    customer: "",
    location: "",
    workOrder: "",
    serviceAppointment: "",
    unitNumber: "",
    equipmentMake: "",
    equipmentModel: "",
    equipmentSerial: "",
    installerName: "",
    ...overrides,
  };
}

// Confirmed live values: Work Order numbers look like "WO21", Service Appointment numbers use
// Zoho's own "AP-" prefix (e.g. "AP-4"), never "SA-".
const linkedInfo: ZohoProjectInfoViewModel = {
  linked: true,
  workOrderNumber: "WO21",
  serviceAppointmentNumber: "AP-2",
  summary: "Install 3 systems",
};

describe("stripRecognizedZohoNumberPrefix", () => {
  it("strips WO with no dash", () => {
    assert.equal(stripRecognizedZohoNumberPrefix("WO7"), "7");
  });

  it("strips WO- with a dash", () => {
    assert.equal(stripRecognizedZohoNumberPrefix("WO-7"), "7");
  });

  it("strips AP with no dash", () => {
    assert.equal(stripRecognizedZohoNumberPrefix("AP4"), "4");
  });

  it("strips AP- with a dash (the real confirmed Zoho SA format)", () => {
    assert.equal(stripRecognizedZohoNumberPrefix("AP-4"), "4");
  });

  it("is case-insensitive and tolerates optional whitespace", () => {
    assert.equal(stripRecognizedZohoNumberPrefix("wo 7"), "7");
    assert.equal(stripRecognizedZohoNumberPrefix("  ap-4  "), "4");
  });

  it("normalizes every reasonable WO whitespace/dash variant to the bare number", () => {
    assert.equal(stripRecognizedZohoNumberPrefix("WO7"), "7");
    assert.equal(stripRecognizedZohoNumberPrefix("WO-7"), "7");
    assert.equal(stripRecognizedZohoNumberPrefix("WO- 7"), "7");
    assert.equal(stripRecognizedZohoNumberPrefix("WO 7"), "7");
    assert.equal(stripRecognizedZohoNumberPrefix("WO - 7"), "7");
  });

  it("normalizes every reasonable AP whitespace/dash variant to the bare number", () => {
    assert.equal(stripRecognizedZohoNumberPrefix("AP4"), "4");
    assert.equal(stripRecognizedZohoNumberPrefix("AP-4"), "4");
    assert.equal(stripRecognizedZohoNumberPrefix("AP- 4"), "4");
    assert.equal(stripRecognizedZohoNumberPrefix("AP 4"), "4");
    assert.equal(stripRecognizedZohoNumberPrefix("AP - 4"), "4");
  });

  it("returns the value unchanged when it does not start with a recognized prefix (never blindly strips characters)", () => {
    assert.equal(stripRecognizedZohoNumberPrefix("SA-7700"), "SA-7700");
    assert.equal(stripRecognizedZohoNumberPrefix("12345"), "12345");
  });

  it("does not treat a word that merely starts with WO/AP as a recognized prefix", () => {
    assert.equal(stripRecognizedZohoNumberPrefix("WORDSTART-99"), "WORDSTART-99");
    assert.equal(stripRecognizedZohoNumberPrefix("APPLE-99"), "APPLE-99");
  });

  it("handles blank/null/undefined without throwing", () => {
    assert.equal(stripRecognizedZohoNumberPrefix(""), "");
    assert.equal(stripRecognizedZohoNumberPrefix("   "), "");
    assert.equal(stripRecognizedZohoNumberPrefix(null), "");
    assert.equal(stripRecognizedZohoNumberPrefix(undefined), "");
  });
});

describe("mergeZohoPrefillIntoCoreJob", () => {
  it("fills blank Work Order # / Service Appointment # from the linked project (card 1), stripping the recognized Zoho prefix", () => {
    const next = mergeZohoPrefillIntoCoreJob(emptyCoreJob(), linkedInfo);
    assert.equal(next.workOrder, "21");
    assert.equal(next.serviceAppointment, "2");
  });

  it("fills the same fields again for a fresh new job card (card 2, 3, 4...) under the same project", () => {
    // Each new job card starts from a blank coreJob — simulate cards 2 and 3 independently.
    const card2 = mergeZohoPrefillIntoCoreJob(emptyCoreJob(), linkedInfo);
    const card3 = mergeZohoPrefillIntoCoreJob(emptyCoreJob(), linkedInfo);
    assert.equal(card2.workOrder, "21");
    assert.equal(card3.workOrder, "21");
    assert.equal(card2.serviceAppointment, "2");
    assert.equal(card3.serviceAppointment, "2");
  });

  it("never overwrites a value the technician already typed", () => {
    const next = mergeZohoPrefillIntoCoreJob(emptyCoreJob({ workOrder: "999" }), linkedInfo);
    assert.equal(next.workOrder, "999");
    assert.equal(next.serviceAppointment, "2");
  });

  it("is a complete no-op for a manually-created (unlinked) project", () => {
    const before = emptyCoreJob({ customer: "Acme" });
    const after = mergeZohoPrefillIntoCoreJob(before, UNLINKED_PROJECT_INFO);
    assert.equal(after, before, "must return the same reference — no state churn for manual projects");
  });

  it("stores only the meaningful portion so the field's own fixed WO-/SA- label prefix isn't doubled up", () => {
    const next = mergeZohoPrefillIntoCoreJob(emptyCoreJob(), {
      linked: true,
      workOrderNumber: "WO-4500",
      serviceAppointmentNumber: "AP-7700",
      summary: null,
    });
    assert.equal(next.workOrder, "4500");
    assert.equal(next.serviceAppointment, "7700");
  });

  it("does not affect zoho_work_order_number/zoho_service_appointment_number display elsewhere — this only changes what is prefilled into coreJob", () => {
    // The "Linked to Zoho FSM" panel reads ZohoProjectInfoViewModel directly (untouched), not
    // the prefilled coreJob value, so it always keeps showing the exact Zoho identifiers.
    const next = mergeZohoPrefillIntoCoreJob(emptyCoreJob(), linkedInfo);
    assert.equal(linkedInfo.workOrderNumber, "WO21");
    assert.equal(linkedInfo.serviceAppointmentNumber, "AP-2");
    assert.notEqual(next.workOrder, linkedInfo.workOrderNumber);
    assert.notEqual(next.serviceAppointment, linkedInfo.serviceAppointmentNumber);
  });
});
