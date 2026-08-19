/**
 * Blaxtair 5 wire-lead + external-alarm email fields — kept separate from both the generic
 * buildInstalledSystemEmailSections (email-sections.ts) and blaxtair-ahd-email.ts so Blaxtair 5's
 * wire-lead requirements can be edited without touching Blaxtair AHD's email output.
 */
import type { InstalledProductComponent, InstalledProductSystem, WireLeadState } from "./types.ts";

export type SimpleEmailField = { label: string; value: string };
export type SimpleEmailSection = { id: string; title: string; fields: SimpleEmailField[] };

type WireDef = { key: string; label: string; required: boolean };

/** Cameras have no wire leads — connections are made at the Camera Hub instead. */
export const BLAXTAIR_5_CAMERA_WIRE_DEFS: WireDef[] = [];

export const BLAXTAIR_5_MONITOR_WIRE_DEFS: WireDef[] = [
  { key: "ground", label: "Black — Constant Ground", required: true },
  { key: "power", label: "Red — Constant Power", required: true },
  { key: "ignition", label: "Green — Ignition Power", required: true },
  { key: "input1", label: "Yellow — Input 1", required: false },
  { key: "input2", label: "Purple — Input 2", required: false },
  { key: "input3", label: "Brown — Input 3", required: false },
  { key: "output1", label: "Blue — Output 1", required: false },
  { key: "output2", label: "Pink — Output 2", required: false },
];

export const BLAXTAIR_5_HUB_WIRE_DEFS: WireDef[] = [
  { key: "power", label: "Power", required: true },
  { key: "ground", label: "Ground", required: true },
  { key: "ignition", label: "Ignition", required: true },
];

function dash(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return t || "—";
}

function wireLeadsField(component: InstalledProductComponent, defs: WireDef[]): SimpleEmailField {
  const used = defs.filter((d) => d.required || component.wireLeads?.[d.key]?.used);
  if (used.length === 0) return { label: `${component.componentLabel} — wire leads`, value: "None used" };
  const value = used
    .map((d) => {
      const lead: WireLeadState = component.wireLeads?.[d.key] ?? { used: d.required, description: "" };
      return `${d.label}: ${dash(lead.description)}`;
    })
    .join(" · ");
  return { label: `${component.componentLabel} — wire leads`, value };
}

/** Extra Blaxtair 5-only email fields: per-component wire leads + the system-level external alarm. */
export function buildBlaxtair5WireAndAlarmEmailSections(
  system: InstalledProductSystem,
): SimpleEmailSection[] {
  const sections: SimpleEmailSection[] = [];
  const monitor = system.components.find((c) => c.componentType === "monitor");
  const hub = system.components.find((c) => c.componentType === "hub");

  // Cameras have no wire leads (BLAXTAIR_5_CAMERA_WIRE_DEFS is empty) — connections are made
  // at the Camera Hub instead, so cameras are deliberately omitted from wireFields.
  const wireFields: SimpleEmailField[] = [];
  if (monitor) wireFields.push(wireLeadsField(monitor, BLAXTAIR_5_MONITOR_WIRE_DEFS));
  if (hub) wireFields.push(wireLeadsField(hub, BLAXTAIR_5_HUB_WIRE_DEFS));
  if (wireFields.length > 0) {
    sections.push({ id: "blaxtair5-wire-leads", title: "Blaxtair 5 — Wire Leads", fields: wireFields });
  }

  const alarm = system.externalAlarm;
  if (alarm?.installed) {
    const triggerLabels = alarm.triggerComponentIds
      .map((id) => system.components.find((c) => c.id === id)?.componentLabel)
      .filter((label): label is string => !!label);
    sections.push({
      id: "blaxtair5-alarm",
      title: "Blaxtair 5 — External Alarm",
      fields: [
        { label: "External alarm installed", value: "Yes" },
        { label: "Triggered by", value: triggerLabels.length > 0 ? triggerLabels.join(", ") : "—" },
      ],
    });
  }

  return sections;
}
