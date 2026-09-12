import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProjectInfoViewModel, UNLINKED_PROJECT_INFO } from "./project-info.ts";

describe("zoho-fsm project info view model", () => {
  it("reports unlinked for a project with no Zoho link row", () => {
    const info = buildProjectInfoViewModel(null);
    assert.deepEqual(info, UNLINKED_PROJECT_INFO);
    assert.equal(info.linked, false);
  });

  it("exposes WO#/SA#/summary for a linked project without leaking raw_snapshot shape details (falls back to Work Order Summary when no Service Appointment snapshot is present)", () => {
    const info = buildProjectInfoViewModel({
      zoho_work_order_number: "WO21",
      zoho_service_appointment_number: "AP-2",
      raw_snapshot: { workOrder: { Summary: "Install 3 systems" } },
    });
    assert.equal(info.linked, true);
    assert.equal(info.workOrderNumber, "WO21");
    assert.equal(info.serviceAppointmentNumber, "AP-2");
    assert.equal(info.summary, "Install 3 systems");
    // The view model itself never carries a raw_snapshot field.
    assert.equal(Object.prototype.hasOwnProperty.call(info, "raw_snapshot"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(info, "rawSnapshot"), false);
  });

  it("prefers the Service Appointment's own Summary over the Work Order's, matching field-mapping.ts's authority order — the banner never shows a different scope than the project's own name", () => {
    const info = buildProjectInfoViewModel({
      zoho_work_order_number: "WO13",
      zoho_service_appointment_number: "AP-10",
      raw_snapshot: {
        workOrder: { Summary: "2 installs" },
        serviceAppointment: { Summary: "1 install" },
      },
    });
    assert.equal(info.summary, "1 install");
  });

  it("falls back to the Work Order Summary when the Service Appointment's own Summary is blank", () => {
    const info = buildProjectInfoViewModel({
      zoho_work_order_number: "WO13",
      zoho_service_appointment_number: "AP-10",
      raw_snapshot: {
        workOrder: { Summary: "2 Camera AHD Demo" },
        serviceAppointment: { Summary: null },
      },
    });
    assert.equal(info.summary, "2 Camera AHD Demo");
  });

  it("degrades gracefully when the snapshot shape is missing/malformed", () => {
    const info = buildProjectInfoViewModel({
      zoho_work_order_number: "WO21",
      zoho_service_appointment_number: "AP-2",
      raw_snapshot: null,
    });
    assert.equal(info.summary, null);
  });
});
