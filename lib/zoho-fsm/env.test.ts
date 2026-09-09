import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getZohoFsmServerEnv } from "./env.ts";

describe("zoho-fsm server env", () => {
  it("defaults the two Work Order custom field API names to the confirmed live values", () => {
    const original = {
      company: process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY,
      siteCode: process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_SITE_CODE,
    };
    delete process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY;
    delete process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_SITE_CODE;
    try {
      const env = getZohoFsmServerEnv();
      assert.equal(env.workOrderCompanyFieldApiName, "Installer_Sheetz_Company__C");
      assert.equal(env.workOrderSiteCodeFieldApiName, "Installer_Sheetz_Site_Code__C");
    } finally {
      if (original.company !== undefined) process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY = original.company;
      if (original.siteCode !== undefined) process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_SITE_CODE = original.siteCode;
    }
  });

  it("still allows an env var override for either field name", () => {
    const original = process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY;
    process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY = "Some_Other_Api_Name__C";
    try {
      const env = getZohoFsmServerEnv();
      assert.equal(env.workOrderCompanyFieldApiName, "Some_Other_Api_Name__C");
    } finally {
      if (original === undefined) delete process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY;
      else process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY = original;
    }
  });

  it("reports missing required credentials/secret", () => {
    const originalValues = {
      clientId: process.env.ZOHO_FSM_CLIENT_ID,
      clientSecret: process.env.ZOHO_FSM_CLIENT_SECRET,
      refreshToken: process.env.ZOHO_FSM_REFRESH_TOKEN,
      webhookSecret: process.env.ZOHO_FSM_WEBHOOK_SECRET,
    };
    delete process.env.ZOHO_FSM_CLIENT_ID;
    delete process.env.ZOHO_FSM_CLIENT_SECRET;
    delete process.env.ZOHO_FSM_REFRESH_TOKEN;
    delete process.env.ZOHO_FSM_WEBHOOK_SECRET;
    try {
      const env = getZohoFsmServerEnv();
      assert.deepEqual(
        [...env.missing].sort(),
        ["ZOHO_FSM_CLIENT_ID", "ZOHO_FSM_CLIENT_SECRET", "ZOHO_FSM_REFRESH_TOKEN", "ZOHO_FSM_WEBHOOK_SECRET"].sort(),
      );
    } finally {
      if (originalValues.clientId !== undefined) process.env.ZOHO_FSM_CLIENT_ID = originalValues.clientId;
      if (originalValues.clientSecret !== undefined) process.env.ZOHO_FSM_CLIENT_SECRET = originalValues.clientSecret;
      if (originalValues.refreshToken !== undefined) process.env.ZOHO_FSM_REFRESH_TOKEN = originalValues.refreshToken;
      if (originalValues.webhookSecret !== undefined) process.env.ZOHO_FSM_WEBHOOK_SECRET = originalValues.webhookSecret;
    }
  });
});
