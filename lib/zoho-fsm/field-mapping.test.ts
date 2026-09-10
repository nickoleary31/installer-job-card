import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildServiceAddressLine,
  extractWorkOrderCustomFieldValue,
  extractWorkOrderIdFromServiceAppointment,
  formatZohoPhoneForV1Display,
  mapZohoRecordsToInboundInput,
  type ZohoServiceAppointmentRecord,
  type ZohoWorkOrderRecord,
} from "./field-mapping.ts";

describe("zoho-fsm field mapping", () => {
  it("reads a Work Order custom field by its confirmed API name", () => {
    const wo: ZohoWorkOrderRecord = { id: "wo-1", Installer_Sheetz_Company__C: "Blaxtair" };
    assert.equal(extractWorkOrderCustomFieldValue(wo, "Installer_Sheetz_Company__C"), "Blaxtair");
    assert.equal(extractWorkOrderCustomFieldValue(wo, "Some_Other_Field"), null);
  });

  it("treats a blank/whitespace custom field value as blank", () => {
    const wo: ZohoWorkOrderRecord = { id: "wo-1", Installer_Sheetz_Company__C: "   " };
    assert.equal(extractWorkOrderCustomFieldValue(wo, "Installer_Sheetz_Company__C"), null);
  });

  it("derives the parent Work Order id from Appointments_X_Services (not a top-level SA field)", () => {
    const sa: ZohoServiceAppointmentRecord = {
      id: "sa-1",
      Name: "AP-2",
      Appointments_X_Services: [{ Work_Order: { id: "wo-1", name: "WO3" } }],
    };
    assert.equal(extractWorkOrderIdFromServiceAppointment(sa), "wo-1");
  });

  it("uses the first line's Work Order when multiple service lines are present", () => {
    const sa: ZohoServiceAppointmentRecord = {
      id: "sa-1",
      Appointments_X_Services: [
        { Work_Order: { id: "wo-1" } },
        { Work_Order: { id: "wo-1" } },
      ],
    };
    assert.equal(extractWorkOrderIdFromServiceAppointment(sa), "wo-1");
  });

  it("returns null (actionable failure) when there is no derivable Work Order reference", () => {
    assert.equal(extractWorkOrderIdFromServiceAppointment({ id: "sa-1" }), null);
    assert.equal(extractWorkOrderIdFromServiceAppointment({ id: "sa-1", Appointments_X_Services: [] }), null);
    assert.equal(
      extractWorkOrderIdFromServiceAppointment({ id: "sa-1", Appointments_X_Services: [{ Work_Order: null }] }),
      null,
    );
  });

  it("builds a human-readable multiline address (Street / City, State Zip) from Zoho's actual Service_ prefixed fields", () => {
    // Real Work Order Service_Address payload confirmed against the live Zoho FSM test org.
    // V1 keeps this as one multiline text value (customers.full_address / projects.location);
    // structured address columns are a V2 concern, not added here.
    assert.equal(
      buildServiceAddressLine({
        id: "addr-1",
        name: "AD-26",
        Service_Street_1: "5811 Priest Rd",
        Service_Street_2: null,
        Service_City: "Acworth",
        Service_State: "GA",
        Service_Country: "United States",
        Service_Zip_Code: "30102",
      }),
      "5811 Priest Rd\nAcworth, GA 30102",
    );
  });

  it("adds Street 2 as its own line only when present", () => {
    assert.equal(
      buildServiceAddressLine({
        Service_Street_1: "5811 Priest Rd",
        Service_Street_2: "Suite 100",
        Service_City: "Acworth",
        Service_State: "GA",
        Service_Zip_Code: "30102",
      }),
      "5811 Priest Rd\nSuite 100\nAcworth, GA 30102",
    );
  });

  it("does not render Service_Country for a normal US address", () => {
    const withCountry = buildServiceAddressLine({
      Service_Street_1: "5811 Priest Rd",
      Service_City: "Acworth",
      Service_State: "GA",
      Service_Zip_Code: "30102",
      Service_Country: "United States",
    });
    assert.doesNotMatch(withCountry ?? "", /United States/);
  });

  it("skips blank/missing address parts without producing stray separators", () => {
    assert.equal(
      buildServiceAddressLine({ Service_Street_1: "123 Main St", Service_City: "Roanoke", Service_State: "VA" }),
      "123 Main St\nRoanoke, VA",
    );
    assert.equal(buildServiceAddressLine({ Service_City: "Roanoke", Service_Zip_Code: "24011" }), "Roanoke, 24011");
    assert.equal(buildServiceAddressLine(null), null);
    assert.equal(buildServiceAddressLine({}), null);
  });

  it("maps a full Work Order + Service Appointment pair into normalized inbound input (using the live test WO's actual values)", () => {
    const input = mapZohoRecordsToInboundInput({
      workOrder: {
        id: "wo-1",
        Name: "WO21",
        Summary: "Install 3 systems",
        Company: { id: "zc-1", name: "Shoppas" },
        // Work_Order.Contact is a reference object only — id + label, confirmed no inline
        // Phone/Email/Mobile against a real payload. Descriptive contact info lives directly on
        // the Work Order instead (Email/Phone/Mobile below).
        Contact: { id: "zct-1", name: "Jane Doe" },
        Email: "jane@example.com",
        Phone: "555-1234",
        Service_Address: {
          id: "46814000000400012",
          name: "AD-26",
          Service_Address_Name: "evergreen acworth",
          Service_Street_1: "1 Plant Rd",
          Service_City: "Roanoke",
          Service_State: "VA",
        },
        Installer_Sheetz_Company__C: "Blaxtair",
      },
      serviceAppointment: { id: "sa-1", Name: "AP-2" },
      companyFieldApiName: "Installer_Sheetz_Company__C",
    });

    assert.equal(input.zohoWorkOrderId, "wo-1");
    assert.equal(input.zohoServiceAppointmentId, "sa-1");
    assert.equal(input.zohoWorkOrderNumber, "WO21");
    assert.equal(input.zohoServiceAppointmentNumber, "AP-2");
    assert.equal(input.installerSheetzCompanyValue, "Blaxtair");
    assert.equal(input.zohoServiceAddressId, "46814000000400012");
    assert.equal(input.siteAddressName, "evergreen acworth");
    assert.equal(input.zohoCompanyId, "zc-1");
    assert.equal(input.dealerName, "Shoppas");
    assert.equal(input.siteAddressLine, "1 Plant Rd\nRoanoke, VA");
    assert.equal(input.siteContactName, "Jane Doe");
    // "555-1234" is only 7 digits (not a full 10-digit US number), so it is left unchanged
    // rather than run through the V1 formatter — see formatZohoPhoneForV1Display tests below.
    assert.equal(input.siteContactPhone, "555-1234");
    assert.equal(input.siteContactEmail, "jane@example.com");
    assert.equal(input.summary, "Install 3 systems");
  });

  it("extracts Service_Address.id as the Site machine identity, trimmed", () => {
    const input = mapZohoRecordsToInboundInput({
      workOrder: { id: "wo-1", Service_Address: { id: "46814000000403249" } },
      serviceAppointment: { id: "sa-1" },
      companyFieldApiName: "Installer_Sheetz_Company__C",
    });
    assert.equal(input.zohoServiceAddressId, "46814000000403249");
  });

  it("maps zohoServiceAddressId to null when Service_Address is missing entirely", () => {
    const input = mapZohoRecordsToInboundInput({
      workOrder: { id: "wo-1" },
      serviceAppointment: { id: "sa-1" },
      companyFieldApiName: "Installer_Sheetz_Company__C",
    });
    assert.equal(input.zohoServiceAddressId, null);
  });

  it("trims Service_Address_Name and treats a blank one as null (never Service_Address.name)", () => {
    const trimmed = mapZohoRecordsToInboundInput({
      workOrder: { id: "wo-1", Service_Address: { id: "addr-1", Service_Address_Name: "  TKP Cherokee GA  " } },
      serviceAppointment: { id: "sa-1" },
      companyFieldApiName: "Installer_Sheetz_Company__C",
    });
    assert.equal(trimmed.siteAddressName, "TKP Cherokee GA");

    const blank = mapZohoRecordsToInboundInput({
      workOrder: { id: "wo-1", Service_Address: { id: "addr-1", Service_Address_Name: "   " } },
      serviceAppointment: { id: "sa-1" },
      companyFieldApiName: "Installer_Sheetz_Company__C",
    });
    assert.equal(blank.siteAddressName, null);
  });

  it("never uses Service_Address.name (Zoho's internal address-record label) as the site name — even when it looks plausible and Service_Address_Name is blank", () => {
    // Exact real payload shape confirmed against the live Zoho FSM test org (raw_snapshot on the
    // zoho_fsm_service_appointments row from the first successful webhook test). Service_Address_
    // Name deliberately omitted here to prove Service_Address.name ("AD-26") is never used as a
    // substitute — the fallback to "<Company> — <Street>" is resolve.ts's job, not this layer's.
    const input = mapZohoRecordsToInboundInput({
      workOrder: {
        id: "wo-1",
        Name: "WO7",
        Company: { id: "zc-1", name: "TEST Account - Delete Me" },
        Service_Address: {
          id: "addr-real",
          name: "AD-26",
          Service_City: "Acworth",
          Service_State: "GA",
          Service_Country: "United States",
          Service_Street_1: "5811 Priest Rd",
          Service_Street_2: null,
          Service_Zip_Code: "30102",
        },
        Installer_Sheetz_Company__C: "Blaxtair",
      },
      serviceAppointment: { id: "sa-1", Name: "AP-4" },
      companyFieldApiName: "Installer_Sheetz_Company__C",
    });

    // Matches the expected V1 output exactly: customers.full_address / projects.location both
    // become this two-line value.
    assert.equal(input.siteAddressLine, "5811 Priest Rd\nAcworth, GA 30102");
    assert.equal(input.zohoServiceAddressId, "addr-real");
    // siteAddressName must stay null — "AD-26" is not a usable site name (confirmed against the
    // Zoho UI: the human-facing "Address Name" field is blank even though the API's Service_
    // Address.name holds "AD-26", an internal reference record name).
    assert.equal(input.siteAddressName, null);
    assert.notEqual(input.siteAddressName, "AD-26");
  });

  it("maps missing optional fields to null rather than throwing", () => {
    const input = mapZohoRecordsToInboundInput({
      workOrder: { id: "wo-2" },
      serviceAppointment: { id: "sa-2" },
      companyFieldApiName: "Installer_Sheetz_Company__C",
    });
    assert.equal(input.installerSheetzCompanyValue, null);
    assert.equal(input.zohoServiceAddressId, null);
    assert.equal(input.siteAddressName, null);
    assert.equal(input.zohoCompanyId, null);
    assert.equal(input.dealerName, null);
    assert.equal(input.siteContactName, null);
    assert.equal(input.siteContactPhone, null);
    assert.equal(input.siteContactEmail, null);
  });

  describe("Work Order-direct contact mapping (Email/Phone/Mobile live on the Work Order, not the Contact record)", () => {
    const baseWorkOrder: ZohoWorkOrderRecord = {
      id: "wo-1",
      Company: { id: "zc-1", name: "Shoppas" },
      Contact: { id: "zct-1", name: "Nick NDJO" },
      Installer_Sheetz_Company__C: "Blaxtair",
    };
    const map = (workOrderOverrides: Partial<ZohoWorkOrderRecord>) =>
      mapZohoRecordsToInboundInput({
        workOrder: { ...baseWorkOrder, ...workOrderOverrides },
        serviceAppointment: { id: "sa-1" },
        companyFieldApiName: "Installer_Sheetz_Company__C",
      });

    it("(1) maps Contact.name / Email / Phone straight off the Work Order when all are populated, formatted to match V1's manual-entry convention", () => {
      const input = map({ Email: "nick@example.com", Phone: "6787809723", Mobile: null });
      assert.equal(input.siteContactName, "Nick NDJO");
      assert.equal(input.siteContactEmail, "nick@example.com");
      assert.equal(input.siteContactPhone, "(678) 780-9723");
    });

    it("(2) prefers Phone [\"Phone Primary\"] when Phone and Mobile are both populated", () => {
      const input = map({ Phone: "770-555-1111", Mobile: "678-555-2222" });
      assert.equal(input.siteContactPhone, "(770) 555-1111");
      // Never concatenated.
      assert.doesNotMatch(input.siteContactPhone ?? "", /678.?555.?2222/);
    });

    it("(3) falls back to Mobile [\"Phone Secondary\"] when Phone is blank", () => {
      const input = map({ Phone: null, Mobile: "678-555-2222" });
      assert.equal(input.siteContactPhone, "(678) 555-2222");
    });

    it("(4) maps to null when both Phone and Mobile are blank", () => {
      const input = map({ Phone: null, Mobile: "   " });
      assert.equal(input.siteContactPhone, null);
    });

    it("(5) maps Email to null when blank", () => {
      const input = map({ Email: "" });
      assert.equal(input.siteContactEmail, null);
    });

    it("(6/7) a later delivery's fresh non-blank WO Phone/Email maps to different values than an earlier one (feeds resolve.ts's already-tested non-destructive refresh)", () => {
      const first = map({ Phone: "770-555-1111", Email: "nick@example.com" });
      const second = map({ Phone: "770-555-9999", Email: "nick.new@example.com" });
      assert.notEqual(first.siteContactPhone, second.siteContactPhone);
      assert.notEqual(first.siteContactEmail, second.siteContactEmail);
      assert.equal(second.siteContactPhone, "(770) 555-9999");
      assert.equal(second.siteContactEmail, "nick.new@example.com");

      // A later delivery with blank WO Phone/Email maps to null at this layer — propagating
      // that non-destructively (never erasing the previously-stored value) is resolve.ts's job,
      // already covered by resolve.test.ts's "(A) non-destructively refreshes...",
      // "(B) does not erase existing descriptive values..." and "(E) populates contact_email..."
      // tests, which don't care whether the value originated from a Contact fetch or the WO
      // directly.
      const blank = map({ Phone: null, Mobile: null, Email: null });
      assert.equal(blank.siteContactPhone, null);
      assert.equal(blank.siteContactEmail, null);
    });

    it("(8) Contact.name may be null while Email/Phone mapping from the Work Order still works independently", () => {
      const input = map({ Contact: null, Email: "nick@example.com", Phone: "6787809723" });
      assert.equal(input.siteContactName, null);
      assert.equal(input.siteContactEmail, "nick@example.com");
      assert.equal(input.siteContactPhone, "(678) 780-9723");
    });

    it("retains the Work Order (with its Email/Phone/Mobile) in raw_snapshot — no separate Contact entry needed", () => {
      const input = map({ Email: "nick@example.com", Phone: "6787809723" });
      // raw.workOrder is the untouched Zoho payload — it keeps the exact original digits, never
      // the V1-formatted siteContactPhone ("(678) 780-9723") derived from it below.
      assert.equal(input.raw.workOrder.Email, "nick@example.com");
      assert.equal(input.raw.workOrder.Phone, "6787809723");
      assert.equal(input.siteContactPhone, "(678) 780-9723");
      assert.equal(input.raw.serviceAppointment.id, "sa-1");
      assert.equal(Object.prototype.hasOwnProperty.call(input.raw, "contact"), false);
    });
  });

  describe("formatZohoPhoneForV1Display", () => {
    it("formats a raw 10-digit US number to match V1's manual-entry convention", () => {
      assert.equal(formatZohoPhoneForV1Display("6787809723"), "(678) 780-9723");
    });

    it("normalizes an already-punctuated 10-digit number to the same canonical form (idempotent)", () => {
      assert.equal(formatZohoPhoneForV1Display("678-780-9723"), "(678) 780-9723");
      assert.equal(formatZohoPhoneForV1Display("(678) 780-9723"), "(678) 780-9723");
      assert.equal(formatZohoPhoneForV1Display("678.780.9723"), "(678) 780-9723");
    });

    it("returns null for blank/null/undefined input", () => {
      assert.equal(formatZohoPhoneForV1Display(""), null);
      assert.equal(formatZohoPhoneForV1Display("   "), null);
      assert.equal(formatZohoPhoneForV1Display(null), null);
      assert.equal(formatZohoPhoneForV1Display(undefined), null);
    });

    it("does not destructively reinterpret a value that is not a plausible 10-digit US number", () => {
      // 11 digits (e.g. a leading country code) — left exactly as Zoho sent it rather than
      // silently truncated into a wrong-looking fake US number.
      assert.equal(formatZohoPhoneForV1Display("+1 678-780-9723"), "+1 678-780-9723");
      // An extension appended after a valid US number is no longer a plain 10-digit value.
      assert.equal(formatZohoPhoneForV1Display("678-780-9723 ext 202"), "678-780-9723 ext 202");
      // A short/partial number (matches the "555-1234" case already covered above).
      assert.equal(formatZohoPhoneForV1Display("555-1234"), "555-1234");
      // A non-numeric or garbage value is returned unchanged, trimmed only.
      assert.equal(formatZohoPhoneForV1Display("  Call front desk  "), "Call front desk");
    });
  });

  describe("Service Appointment Summary as project-scope source (business model: Work Order is umbrella scope, a Service Appointment is one visit's own scope)", () => {
    const map = (workOrderOverrides: Partial<ZohoWorkOrderRecord>, serviceAppointmentOverrides: Partial<ZohoServiceAppointmentRecord>) =>
      mapZohoRecordsToInboundInput({
        workOrder: { id: "wo-1", Company: { id: "zc-1" }, ...workOrderOverrides },
        serviceAppointment: { id: "sa-1", Name: "AP-10", ...serviceAppointmentOverrides },
        companyFieldApiName: "Installer_Sheetz_Company__C",
      });

    it("uses the Service Appointment's own Summary, never the Work Order's, when both are present and differ (confirmed against the real AP-10 payload shape)", () => {
      const input = map({ Summary: "2 installs" }, { Summary: "1 install" });
      assert.equal(input.summary, "1 install");
    });

    it("falls back to the Work Order Summary only when the Service Appointment's own Summary is blank", () => {
      const input = map({ Summary: "2 Camera AHD Demo" }, { Summary: null });
      assert.equal(input.summary, "2 Camera AHD Demo");
    });

    it("falls back to the Work Order Summary when the Service Appointment's own Summary is whitespace-only", () => {
      const input = map({ Summary: "2 Camera AHD Demo" }, { Summary: "   " });
      assert.equal(input.summary, "2 Camera AHD Demo");
    });

    it("maps to null (not the Work Order Summary) when both are blank", () => {
      const input = map({ Summary: null }, { Summary: null });
      assert.equal(input.summary, null);
    });

    it("a Work Order Summary edit does not change the mapped summary as long as the Service Appointment's own Summary stays fixed (WO change must not fan out to an existing visit's scope)", () => {
      const before = map({ Summary: "1 install" }, { Summary: "Install VAC4" });
      const afterWoEdit = map({ Summary: "2 installs" }, { Summary: "Install VAC4" });
      assert.equal(before.summary, "Install VAC4");
      assert.equal(afterWoEdit.summary, "Install VAC4");
      assert.equal(before.summary, afterWoEdit.summary);
    });

    it("raw_snapshot retains both the Work Order's and Service Appointment's own Summary values unchanged, for diagnostics/context", () => {
      const input = map({ Summary: "2 installs" }, { Summary: "1 install" });
      assert.equal(input.raw.workOrder.Summary, "2 installs");
      assert.equal(input.raw.serviceAppointment.Summary, "1 install");
    });
  });
});
