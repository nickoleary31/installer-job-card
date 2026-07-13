import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEmailAttachmentFilename, sanitizeFilenamePart } from "./email-attachment-filenames.ts";
import {
  INTERNAL_ALWAYS_EMAIL,
  INTERNAL_ONLY_EMAIL,
  mergeRecipientsByEmail,
  resolveJobCardEmailRecipients,
} from "./email-recipients.ts";

describe("email-attachment-filenames", () => {
  it("builds customer_asset_field filename", () => {
    const name = buildEmailAttachmentFilename({
      customer: "Low Country Concrete",
      assetNumber: "E2",
      fieldLabel: "Vehicle Front",
      sequenceInField: 1,
    });
    assert.equal(name, "Low_Country_Concrete_E2_Vehicle_Front.jpg");
  });

  it("adds sequence suffix for duplicates", () => {
    const name = buildEmailAttachmentFilename({
      customer: "Acme",
      assetNumber: "T1",
      fieldLabel: "Wire Path",
      sequenceInField: 2,
    });
    assert.match(name, /_2\.jpg$/);
  });

  it("sanitizes invalid characters", () => {
    assert.equal(sanitizeFilenamePart('Test/Co: "A"'), "TestCo_A");
  });
});

describe("email-recipients", () => {
  it("client+internal includes always, env, and project externals", () => {
    const r = resolveJobCardEmailRecipients({
      sendMode: "client_and_internal",
      payload: {
        projectRecipientEmails: ["janet@lowcountryconcrete.net", "rcharles@linxup.com"],
      },
      jobCardEmailToEnv: "customerservice@tkpautomotive.com",
    });
    const emails = r.toAddresses.sort();
    assert.ok(emails.includes(INTERNAL_ALWAYS_EMAIL));
    assert.ok(emails.includes("customerservice@tkpautomotive.com"));
    assert.ok(emails.includes("janet@lowcountryconcrete.net"));
    assert.ok(emails.includes("rcharles@linxup.com"));
  });

  it("internal only sends only nick@tkptelematics.com", () => {
    const r = resolveJobCardEmailRecipients({
      sendMode: "internal_only",
      payload: { projectRecipientEmails: ["janet@lowcountryconcrete.net", "Nick@tkptelematics.com"] },
      jobCardEmailToEnv: "customerservice@tkpautomotive.com",
    });
    assert.deepEqual(r.toAddresses, [INTERNAL_ONLY_EMAIL]);
    assert.equal(r.to.length, 1);
    assert.equal(r.to[0]?.source, "internal_only_mode");
  });

  it("dedupes nick case-insensitively to a single final send address", () => {
    const r = resolveJobCardEmailRecipients({
      sendMode: "client_and_internal",
      payload: {
        projectRecipientEmails: [
          "janet@lowcountryconcrete.net",
          "Nick@tkptelematics.com",
          "nick@tkptelematics.com",
          "NICK@TKPTELEMATICS.COM",
          "rcharles@linxup.com",
        ],
      },
      jobCardEmailToEnv: "customerservice@tkpautomotive.com",
    });
    assert.equal(r.toAddresses.filter((e) => e === INTERNAL_ONLY_EMAIL).length, 1);
    assert.equal(r.to.filter((x) => x.email === INTERNAL_ONLY_EMAIL).length, 1);
    const nick = r.to.find((x) => x.email === INTERNAL_ONLY_EMAIL);
    assert.equal(nick?.source, "project_external");
    assert.ok(nick?.sourceHistory.some((h) => h.source === "project_external"));
  });

  it("merges multi-source nick into one entry with source history", () => {
    const r = resolveJobCardEmailRecipients({
      sendMode: "client_and_internal",
      payload: {
        projectRecipientEmails: ["Nick@tkptelematics.com"],
      },
      jobCardEmailToEnv: "nick@tkptelematics.com",
    });
    assert.deepEqual(r.toAddresses.filter((e) => e === INTERNAL_ONLY_EMAIL), [INTERNAL_ONLY_EMAIL]);
    const nick = r.to.find((x) => x.email === INTERNAL_ONLY_EMAIL);
    assert.ok(nick);
    assert.equal(nick.source, "internal_env");
    assert.ok(nick.sourceHistory.some((h) => h.source === "internal_env"));
    assert.ok(nick.sourceHistory.some((h) => h.source === "project_external"));
  });

  it("E2-like list delivers five unique addresses with nick once", () => {
    const r = resolveJobCardEmailRecipients({
      sendMode: "client_and_internal",
      payload: {
        projectRecipientEmails: [
          "janet@lowcountryconcrete.net",
          "nick@tkptelematics.com",
          "rcharles@linxup.com",
        ],
      },
      jobCardEmailToEnv: "customerservice@tkpautomotive.com",
    });
    assert.deepEqual(r.toAddresses.sort(), [
      "customerservice@tkpautomotive.com",
      "installs@tkpautomotive.com",
      "janet@lowcountryconcrete.net",
      "nick@tkptelematics.com",
      "rcharles@linxup.com",
    ]);
  });
});

describe("mergeRecipientsByEmail", () => {
  it("keeps one entry and preserves source history", () => {
    const merged = mergeRecipientsByEmail([
      {
        email: "Nick@Example.com",
        source: "project_external",
        label: "Project",
        route: "to",
        sourceHistory: [{ source: "project_external", label: "Project" }],
      },
      {
        email: "nick@example.com",
        source: "internal_env",
        label: "Env",
        route: "to",
        sourceHistory: [{ source: "internal_env", label: "Env" }],
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.email, "nick@example.com");
    assert.equal(merged[0]?.source, "internal_env");
    assert.equal(merged[0]?.sourceHistory.length, 2);
  });
});
