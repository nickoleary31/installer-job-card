import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendInstallationEvents,
  findCrossFormInstall,
  getCurrentInstallation,
  getDeviceHistory,
  type DeviceInstallationEvent,
} from "./blaxtair-install-registry.ts";

function event(
  partial: Partial<DeviceInstallationEvent> & Pick<DeviceInstallationEvent, "id" | "systemId" | "installedAt">,
): DeviceInstallationEvent {
  return {
    partNumber: "210-110-001",
    serialNumber: "26062215",
    componentId: `comp-${partial.id}`,
    componentLabel: "Camera 1",
    status: "installed",
    ...partial,
  };
}

describe("Blaxtair device installation history", () => {
  it("getCurrentInstallation returns the most recent event for a device key", () => {
    const events = [
      event({ id: "e1", systemId: "sys-A", installedAt: "2026-08-01T00:00:00.000Z" }),
      event({ id: "e2", systemId: "sys-B", installedAt: "2026-08-02T00:00:00.000Z", status: "reinstalled" }),
    ];
    const current = getCurrentInstallation(events, "210-110-001", "26062215");
    assert.equal(current?.systemId, "sys-B");
    assert.equal(current?.status, "reinstalled");
  });

  it("is keyed by part number + serial number, not serial alone", () => {
    const events = [
      event({ id: "e1", systemId: "sys-A", installedAt: "2026-08-01T00:00:00.000Z", partNumber: "999-999-999" }),
    ];
    const current = getCurrentInstallation(events, "210-110-001", "26062215");
    assert.equal(current, null);
  });

  it("getDeviceHistory returns full chronological history, not just the latest", () => {
    const events = [
      event({ id: "e1", systemId: "sys-A", installedAt: "2026-08-01T00:00:00.000Z" }),
      event({ id: "e2", systemId: "sys-A", installedAt: "2026-08-01T01:00:00.000Z", status: "removed" }),
      event({ id: "e3", systemId: "sys-B", installedAt: "2026-08-02T00:00:00.000Z", status: "transferred" }),
    ];
    const history = getDeviceHistory(events, "210-110-001", "26062215");
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((e) => e.id),
      ["e1", "e2", "e3"],
    );
  });

  it("findCrossFormInstall flags a device currently installed under a different system", () => {
    const events = [event({ id: "e1", systemId: "sys-A", installedAt: "2026-08-01T00:00:00.000Z" })];
    const found = findCrossFormInstall(events, {
      serialNumber: "26062215",
      partNumber: "210-110-001",
      excludeSystemId: "sys-B",
    });
    assert.equal(found?.systemId, "sys-A");
  });

  it("findCrossFormInstall does not flag the device's own current system", () => {
    const events = [event({ id: "e1", systemId: "sys-A", installedAt: "2026-08-01T00:00:00.000Z" })];
    const found = findCrossFormInstall(events, {
      serialNumber: "26062215",
      partNumber: "210-110-001",
      excludeSystemId: "sys-A",
    });
    assert.equal(found, null);
  });

  it("findCrossFormInstall does not flag a device whose latest event moved it away already (removed elsewhere is not 'this system')", () => {
    // A device installed on sys-A, then legitimately removed and reinstalled on sys-B: the
    // *current* installation is sys-B, so completing sys-B again is not cross-form reuse.
    const events = [
      event({ id: "e1", systemId: "sys-A", installedAt: "2026-08-01T00:00:00.000Z" }),
      event({ id: "e2", systemId: "sys-B", installedAt: "2026-08-02T00:00:00.000Z", status: "reinstalled" }),
    ];
    const found = findCrossFormInstall(events, {
      serialNumber: "26062215",
      partNumber: "210-110-001",
      excludeSystemId: "sys-B",
    });
    assert.equal(found, null);
  });

  it("appendInstallationEvents never mutates or replaces prior events (immutable history)", () => {
    const original = [event({ id: "e1", systemId: "sys-A", installedAt: "2026-08-01T00:00:00.000Z" })];
    const next = appendInstallationEvents(original, [
      event({ id: "e2", systemId: "sys-B", installedAt: "2026-08-02T00:00:00.000Z", status: "reinstalled" }),
    ]);
    assert.equal(next.length, 2);
    assert.equal(original.length, 1);
    assert.equal(next[0]?.id, "e1");
    assert.equal(next[1]?.id, "e2");
  });
});
