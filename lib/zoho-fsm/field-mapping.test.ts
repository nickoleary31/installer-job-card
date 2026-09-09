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

  it("builds a readable address line from Service_Address parts, skipping blanks", () => {
    assert.equal(
      buildServiceAddressLine({
        Street_1: "123 Main St",
        Street_2: "",
        City: "Roanoke",
        State: "VA",
        Zip_Code: "24011",
      }),
      "123 Main St, Roanoke, VA, 24011",
    );
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
        Service_Address: { Address_Name: "GM - Voltova Roanoke", Street_1: "1 Plant Rd", City: "Roanoke", State: "VA" },
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
    assert.equal(input.siteAddressName, "GM - Voltova Roanoke");
    assert.equal(input.siteContactName, "Jane Doe");
    assert.equal(input.siteContactPhone, "555-1234");
    assert.equal(input.summary, "Install 3 systems");
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
