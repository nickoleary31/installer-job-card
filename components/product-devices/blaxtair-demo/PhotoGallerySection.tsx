"use client";

import type { BlaxtairDemoJobCard, BlaxtairJobCardPhoto } from "@/lib/prototype/blaxtair-job-card";
import type { PhotoCategory } from "@/lib/prototype/photo-dedup-registry";
import { PhotoField } from "./PhotoField";

const FIXED_CATEGORIES: Array<{ category: PhotoCategory; label: string; required: boolean; connectionKey?: "power" | "ground" | "ignition" }> = [
  { category: "vehicle_overview", label: "Vehicle / asset overview", required: true },
  { category: "vin", label: "VIN / identifying label", required: true },
  { category: "odometer", label: "Odometer / engine-hours display", required: true },
  { category: "power_connection", label: "Power connection", required: true, connectionKey: "power" },
  { category: "ground_connection", label: "Ground connection", required: true, connectionKey: "ground" },
  { category: "ignition_connection", label: "Ignition connection", required: true, connectionKey: "ignition" },
  { category: "device_mounting", label: "Device / monitor mounting", required: true },
  { category: "camera_mounting", label: "Camera mounting", required: true },
  { category: "camera_view", label: "Camera viewing position", required: true },
  { category: "completed_installation", label: "Completed installation", required: true },
  { category: "equipment_label", label: "Additional equipment label (rating plate, etc.)", required: false },
];

export function PhotoGallerySection(props: {
  jobCard: BlaxtairDemoJobCard;
  onAdd: (photo: Omit<BlaxtairJobCardPhoto, "id">) => void;
  onReplace: (id: string, photo: Omit<BlaxtairJobCardPhoto, "id">) => void;
  onRemove: (id: string) => void;
  onUpdateDescription: (id: string, description: string) => void;
  blockMessage: string | null;
}) {
  const { jobCard } = props;
  const photoFor = (category: PhotoCategory) => jobCard.photos.find((p) => p.category === category && p.category !== "other") ?? null;
  const otherPhotos = jobCard.photos.filter((p) => p.category === "other");

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium text-emerald-200">Required Installation Photos</h2>
      {props.blockMessage ? (
        <p className="rounded-lg border border-red-700/50 bg-red-950/30 p-3 text-sm text-red-200">{props.blockMessage}</p>
      ) : null}
      <p className="text-xs text-slate-500">
        A photo already used elsewhere on this job card, in a saved draft, or on a different completed demo
        submission is blocked — regardless of which category it&apos;s used for.
      </p>

      {FIXED_CATEGORIES.filter((c) => !c.connectionKey || jobCard.installation[c.connectionKey].applicable).map((c) => (
        <PhotoField
          key={c.category}
          category={c.category}
          label={c.label}
          required={c.required}
          photo={photoFor(c.category)}
          onAdd={props.onAdd}
          onReplace={props.onReplace}
          onRemove={props.onRemove}
          onDescriptionChange={props.onUpdateDescription}
        />
      ))}

      <div className="space-y-2">
        <p className="text-sm font-medium">Additional installation photos</p>
        {otherPhotos.map((p) => (
          <PhotoField
            key={p.id}
            category="other"
            label={p.description || "Additional photo"}
            photo={p}
            onAdd={props.onAdd}
            onReplace={props.onReplace}
            onRemove={props.onRemove}
            onDescriptionChange={props.onUpdateDescription}
          />
        ))}
        <PhotoField
          category="other"
          label="Add another photo"
          photo={null}
          onAdd={props.onAdd}
          onReplace={props.onReplace}
          onRemove={props.onRemove}
          onDescriptionChange={props.onUpdateDescription}
        />
      </div>
    </section>
  );
}
