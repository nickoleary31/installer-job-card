import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deviceFamilyFromFormId,
  getDeviceFamilyProfile,
  getVariantProfile,
  resolveGuideForDevice,
} from "./device-family.ts";
import { resolveInstallGuide } from "./install-guide.ts";

describe("install guide + device family architecture", () => {
  it("maps three form ids to device families", () => {
    assert.equal(deviceFamilyFromFormId("linxup_asset_tracker"), "linxup_asset_tracker");
    assert.equal(deviceFamilyFromFormId("linxup_vehicle_tracker"), "linxup_vehicle_tracker");
    assert.equal(deviceFamilyFromFormId("linxup_linxcam"), "linxup_linxcam");
  });

  it("requires OBD-II / JBUS variant only for vehicle tracker", () => {
    assert.equal(getDeviceFamilyProfile("linxup_vehicle_tracker").requiresInstallationVariant, true);
    assert.equal(getDeviceFamilyProfile("linxup_asset_tracker").requiresInstallationVariant, false);
    assert.equal(getDeviceFamilyProfile("linxup_linxcam").requiresInstallationVariant, false);
    assert.ok(getVariantProfile("linxup_vehicle_tracker", "obd_ii"));
    assert.ok(getVariantProfile("linxup_vehicle_tracker", "jbus"));
    assert.equal(getVariantProfile("linxup_vehicle_tracker", null), null);
  });

  it("resolves preferred cached guide with manufacturer fallback", () => {
    const resolved = resolveGuideForDevice("linxup_asset_tracker", "standard");
    assert.equal(resolved.available, true);
    assert.equal(resolved.usedSource, "cached");
    assert.equal(resolved.sourceLabel, "cached copy");
    assert.ok(resolved.openUrl?.includes("/guides/linxup/at3"));
  });

  it("OBD and JBUS guides are distinct", () => {
    const obd = resolveGuideForDevice("linxup_vehicle_tracker", "obd_ii");
    const jbus = resolveGuideForDevice("linxup_vehicle_tracker", "jbus");
    assert.notEqual(obd.definition.title, jbus.definition.title);
    assert.notEqual(obd.openUrl, jbus.openUrl);
  });

  it("disabled guide is unavailable without blocking callers", () => {
    const r = resolveInstallGuide({
      title: "Old",
      sourceUrl: "https://example.com/a.pdf",
      cachedUrl: "/guides/old.pdf",
      documentType: "pdf",
      version: "2020",
      revision: null,
      lastVerifiedAt: null,
      preferredSource: "cached",
      fallbackSource: "manufacturer",
      disabled: true,
      disabledReason: "Superseded",
    });
    assert.equal(r.available, false);
    assert.match(r.unavailableMessage || "", /Superseded/);
  });

  it("falls back to manufacturer when cached missing", () => {
    const r = resolveInstallGuide({
      title: "X",
      sourceUrl: "https://example.com/guide.pdf",
      cachedUrl: null,
      documentType: "pdf",
      version: "1",
      revision: null,
      lastVerifiedAt: null,
      preferredSource: "cached",
      fallbackSource: "manufacturer",
    });
    assert.equal(r.usedSource, "manufacturer");
    assert.equal(r.openUrl, "https://example.com/guide.pdf");
  });
});
