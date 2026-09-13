import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkEvidencePdfAccess } from "./evidence-pdf-access.ts";

describe("zoho-fsm evidence PDF access check", () => {
  it("allows a submission that belongs to the SA's own linked project", () => {
    const result = checkEvidencePdfAccess({
      serviceAppointmentProjectId: "project-1",
      submissionProjectId: "project-1",
    });
    assert.deepEqual(result, { ok: true });
  });

  it("rejects an unknown Service Appointment", () => {
    const result = checkEvidencePdfAccess({
      serviceAppointmentProjectId: null,
      submissionProjectId: "project-1",
    });
    assert.deepEqual(result, { ok: false, reason: "unknown_service_appointment" });
  });

  it("rejects an unknown submission", () => {
    const result = checkEvidencePdfAccess({
      serviceAppointmentProjectId: "project-1",
      submissionProjectId: null,
    });
    assert.deepEqual(result, { ok: false, reason: "unknown_submission" });
  });

  it("rejects a submission that belongs to a different project than the SA — cannot use a valid submissionId to pull an arbitrary job card via someone else's SA", () => {
    const result = checkEvidencePdfAccess({
      serviceAppointmentProjectId: "project-1",
      submissionProjectId: "project-2",
    });
    assert.deepEqual(result, { ok: false, reason: "submission_not_in_project" });
  });

  it("treats an unknown SA as the reported failure even when the submission is also unknown, rather than leaking which check failed first", () => {
    const result = checkEvidencePdfAccess({
      serviceAppointmentProjectId: null,
      submissionProjectId: null,
    });
    assert.equal(result.ok, false);
  });
});
