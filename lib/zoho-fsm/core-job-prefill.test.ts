import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeZohoPrefillIntoCoreJob } from "./core-job-prefill.ts";
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

const linkedInfo: ZohoProjectInfoViewModel = {
  linked: true,
  workOrderNumber: "WO21",
  serviceAppointmentNumber: "AP-2",
  summary: "Install 3 systems",
};

describe("mergeZohoPrefillIntoCoreJob", () => {
  it("fills blank Work Order # / Service Appointment # from the linked project (card 1)", () => {
    const next = mergeZohoPrefillIntoCoreJob(emptyCoreJob(), linkedInfo);
    assert.equal(next.workOrder, "21");
    assert.equal(next.serviceAppointment, "AP-2");
  });

  it("fills the same fields again for a fresh new job card (card 2, 3, 4...) under the same project", () => {
    // Each new job card starts from a blank coreJob — simulate cards 2 and 3 independently.
    const card2 = mergeZohoPrefillIntoCoreJob(emptyCoreJob(), linkedInfo);
    const card3 = mergeZohoPrefillIntoCoreJob(emptyCoreJob(), linkedInfo);
    assert.equal(card2.workOrder, "21");
    assert.equal(card3.workOrder, "21");
    assert.equal(card2.serviceAppointment, "AP-2");
    assert.equal(card3.serviceAppointment, "AP-2");
  });

  it("never overwrites a value the technician already typed", () => {
    const next = mergeZohoPrefillIntoCoreJob(emptyCoreJob({ workOrder: "999" }), linkedInfo);
    assert.equal(next.workOrder, "999");
    assert.equal(next.serviceAppointment, "AP-2");
  });

  it("is a complete no-op for a manually-created (unlinked) project", () => {
    const before = emptyCoreJob({ customer: "Acme" });
    const after = mergeZohoPrefillIntoCoreJob(before, UNLINKED_PROJECT_INFO);
    assert.equal(after, before, "must return the same reference — no state churn for manual projects");
  });

  it("strips the WO-/SA- prefix convention so it matches the existing raw-value field storage", () => {
    const next = mergeZohoPrefillIntoCoreJob(emptyCoreJob(), {
      linked: true,
      workOrderNumber: "WO-4500",
      serviceAppointmentNumber: "SA-7700",
      summary: null,
    });
    assert.equal(next.workOrder, "4500");
    assert.equal(next.serviceAppointment, "7700");
  });
});
