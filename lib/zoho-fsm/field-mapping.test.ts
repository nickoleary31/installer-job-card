import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildServiceAddressLine,
  extractWorkOrderCustomFieldValue,
  extractWorkOrderIdFromServiceAppointment,
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
    const wo: ZohoWorkOrderRecord = { id: "wo-1", Installer_Sheetz_Site_Code__C: "   " };
    assert.equal(extractWorkOrderCustomFieldValue(wo, "Installer_Sheetz_Site_Code__C"), null);
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
        Contact: { id: "zct-1", name: "Jane Doe", Phone: "555-1234", Email: "jane@example.com" },
        Service_Address: {
          id: "addr-1",
          name: "AD-26",
          Service_Street_1: "1 Plant Rd",
          Service_City: "Roanoke",
          Service_State: "VA",
        },
        Installer_Sheetz_Company__C: "Blaxtair",
        Installer_Sheetz_Site_Code__C: "TEST-ROANOKE",
      },
      serviceAppointment: { id: "sa-1", Name: "AP-2" },
      companyFieldApiName: "Installer_Sheetz_Company__C",
      siteCodeFieldApiName: "Installer_Sheetz_Site_Code__C",
    });

    assert.equal(input.zohoWorkOrderId, "wo-1");
    assert.equal(input.zohoServiceAppointmentId, "sa-1");
    assert.equal(input.zohoWorkOrderNumber, "WO21");
    assert.equal(input.zohoServiceAppointmentNumber, "AP-2");
    assert.equal(input.installerSheetzCompanyValue, "Blaxtair");
    assert.equal(input.zohoSiteCode, "TEST-ROANOKE");
    assert.equal(input.zohoCompanyId, "zc-1");
    assert.equal(input.dealerName, "Shoppas");
    assert.equal(input.siteAddressLine, "1 Plant Rd\nRoanoke, VA");
    assert.equal(input.siteContactName, "Jane Doe");
    assert.equal(input.siteContactPhone, "555-1234");
    assert.equal(input.summary, "Install 3 systems");
  });

  it("never uses Service_Address.name (Zoho's internal address-record label) as the site name", () => {
    // Exact real payload confirmed against the live Zoho FSM test org (raw_snapshot on the
    // zoho_fsm_service_appointments row from the first successful webhook test).
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
        Installer_Sheetz_Site_Code__C: "TEST-ROANOKE",
      },
      serviceAppointment: { id: "sa-1", Name: "AP-4" },
      companyFieldApiName: "Installer_Sheetz_Company__C",
      siteCodeFieldApiName: "Installer_Sheetz_Site_Code__C",
    });

    // Matches the expected V1 output exactly: customers.full_address / projects.location both
    // become this two-line value; customers.customer_name stays "TEST-ROANOKE" (the site code),
    // never "AD-26".
    assert.equal(input.siteAddressLine, "5811 Priest Rd\nAcworth, GA 30102");
    // siteAddressName must stay null — "AD-26" is not a usable site name (confirmed against the
    // Zoho UI: the human-facing "Address Name" field is blank even though the API's Service_
    // Address.name holds "AD-26", an internal reference record name). resolve.ts's
    // fallbackSiteName() falls back to zohoSiteCode ("TEST-ROANOKE") when this is null.
    assert.equal(input.siteAddressName, null);
    assert.notEqual(input.siteAddressName, "AD-26");
  });

  it("maps missing optional fields to null rather than throwing", () => {
    const input = mapZohoRecordsToInboundInput({
      workOrder: { id: "wo-2" },
      serviceAppointment: { id: "sa-2" },
      companyFieldApiName: "Installer_Sheetz_Company__C",
      siteCodeFieldApiName: "Installer_Sheetz_Site_Code__C",
    });
    assert.equal(input.installerSheetzCompanyValue, null);
    assert.equal(input.zohoSiteCode, null);
    assert.equal(input.zohoCompanyId, null);
    assert.equal(input.dealerName, null);
  });
});
