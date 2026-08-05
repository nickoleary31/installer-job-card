/**
 * Blaxtair AHD wire-lead + external-alarm email fields — kept separate from the generic
 * buildInstalledSystemEmailSections (email-sections.ts) so that shared function stays
 * product-agnostic (identifiers/mounting/view only) while Blaxtair gets its richer output.
 */
import type { InstalledProductComponent, InstalledProductSystem, WireLeadState } from "./types.ts";

export type SimpleEmailField = { label: string; value: string };
export type SimpleEmailSection = { id: string; title: string; fields: SimpleEmailField[] };

type WireDef = { key: string; label: string; required: boolean };

export const BLAXTAIR_CAMERA_WIRE_DEFS: WireDef[] = [
  { key: "ground", label: "Black — Ground", required: false },
  { key: "out1", label: "Red — Out 1", required: false },
  { key: "out2", label: "Yellow — Out 2", required: false },
  { key: "out3", label: "Green — Out 3", required: false },
  { key: "in1", label: "White — In 1", required: false },
];

export const BLAXTAIR_MONITOR_WIRE_DEFS: WireDef[] = [
  { key: "ground", label: "Black — Ground", required: true },
  { key: "power", label: "Red — Constant Power", required: true },
  { key: "ignition", label: "Orange — Ignition", required: true },
  { key: "trigger1", label: "White — Trigger 1", required: false },
  { key: "trigger2", label: "Blue — Trigger 2", required: false },
  { key: "trigger3", label: "Green — Trigger 3", required: false },
  { key: "trigger4", label: "Brown — Trigger 4", required: false },
  { key: "trigger5", label: "Yellow — Trigger 5", required: false },
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

/** Extra Blaxtair-only email fields: per-component wire leads + the system-level external alarm. */
export function buildBlaxtairWireAndAlarmEmailSections(
  system: InstalledProductSystem,
): SimpleEmailSection[] {
  const sections: SimpleEmailSection[] = [];
  const cameras = system.components
    .filter((c) => c.componentType === "camera")
    .slice()
    .sort((a, b) => (a.slotKey < b.slotKey ? -1 : 1));
  const monitor = system.components.find((c) => c.componentType === "monitor");

  const wireFields: SimpleEmailField[] = [];
  for (const c of cameras) wireFields.push(wireLeadsField(c, BLAXTAIR_CAMERA_WIRE_DEFS));
  if (monitor) wireFields.push(wireLeadsField(monitor, BLAXTAIR_MONITOR_WIRE_DEFS));
  if (wireFields.length > 0) {
    sections.push({ id: "blaxtair-wire-leads", title: "Blaxtair AHD — Wire Leads", fields: wireFields });
  }

  const alarm = system.externalAlarm;
  if (alarm?.installed) {
    const triggerLabels = alarm.triggerComponentIds
      .map((id) => system.components.find((c) => c.id === id)?.componentLabel)
      .filter((label): label is string => !!label);
    sections.push({
      id: "blaxtair-alarm",
      title: "Blaxtair AHD — External Alarm",
      fields: [
        { label: "External alarm installed", value: "Yes" },
        { label: "Triggered by", value: triggerLabels.length > 0 ? triggerLabels.join(", ") : "—" },
      ],
    });
  }

  return sections;
}
