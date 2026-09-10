import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getZohoFsmServerEnv } from "./env.ts";

describe("zoho-fsm server env", () => {
  it("defaults the Work Order custom field API name to the confirmed live value", () => {
    const original = process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY;
    delete process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY;
    try {
      const env = getZohoFsmServerEnv();
      assert.equal(env.workOrderCompanyFieldApiName, "Installer_Sheetz_Company__C");
    } finally {
      if (original !== undefined) process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY = original;
    }
  });

  it("no longer exposes a Site Code field name — Site identity is Zoho's own Service_Address.id, not a custom field", () => {
    const env = getZohoFsmServerEnv();
    assert.equal("workOrderSiteCodeFieldApiName" in env, false);
  });

  it("still allows an env var override for the company field name", () => {
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
