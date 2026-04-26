"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type PhotoItem = {
  group: "vehicle" | "vac4";
  fieldName: string;
  label: string;
  filename: string;
  storagePath: string;
  publicUrl: string;
};

const PHOTO_FIELD_LABELS: Record<string, string> = {
  vacMounting: "VAC mounting",
  wirePath: "Wire path",
  redWire: "Red wire",
  blackWire: "Black wire",
  blueWire: "Blue wire",
  brownWire: "Brown wire",
  sensorHubMounting: "Sensor hub mounting",
  speedSense: "Speed sense",
  loadSense: "Load sense",
  gps: "GPS",
  externalIndicator: "External indicator",
  purpleWire: "Purple wire",
  relayAccess: "Relay access control",
  impactSensor: "Impact sensor mounting",
  vehicleFront: "Front",
  vehicleSide: "Side",
  vehicleRear: "Rear",
};

const PHOTO_GROUP_TITLES: Record<"vehicle" | "vac4", string> = {
  vehicle: "Vehicle Photos",
  vac4: "VAC4 Photos",
};

export default function PhotoGalleryPage() {
  const params = useParams<{ submissionId: string }>();
  const submissionId = params?.submissionId || "";
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadPhotos = async () => {
      if (!submissionId) return;
      try {
        const basePath = submissionId;
        const { data: groupEntries, error: listError } = await supabase.storage.from("job-card-photos").list(basePath, {
          limit: 200,
        });
        if (listError) throw listError;
        if (!groupEntries) {
          if (!cancelled) setPhotos([]);
          return;
        }

        const nextPhotos: PhotoItem[] = [];
        for (const groupEntry of groupEntries) {
          const groupName = groupEntry.name;
          if (groupName !== "vehicle" && groupName !== "vac4") continue;
          const { data: fieldEntries, error: fieldListError } = await supabase.storage
            .from("job-card-photos")
            .list(`${basePath}/${groupName}`, { limit: 200 });
          if (fieldListError || !fieldEntries) continue;
          for (const fieldEntry of fieldEntries) {
            const fieldName = fieldEntry.name;
            const { data: files, error: fileListError } = await supabase.storage
              .from("job-card-photos")
              .list(`${basePath}/${groupName}/${fieldName}`, { limit: 200 });
            if (fileListError || !files) continue;
            for (const file of files) {
              const storagePath = `${basePath}/${groupName}/${fieldName}/${file.name}`;
              const { data } = supabase.storage.from("job-card-photos").getPublicUrl(storagePath);
              if (!data?.publicUrl) continue;
              nextPhotos.push({
                group: groupName,
                fieldName,
                label: PHOTO_FIELD_LABELS[fieldName] || fieldName,
                filename: file.name,
                storagePath,
                publicUrl: data.publicUrl,
              });
            }
          }
        }

        if (!cancelled) {
          setPhotos(nextPhotos);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setPhotos([]);
          setLoadError(e instanceof Error ? e.message : "Unable to load photos.");
        }
      }
    };
    loadPhotos();
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  const grouped = useMemo(() => {
    const groups = new Map<"vehicle" | "vac4", Map<string, { label: string; items: PhotoItem[] }>>();
    for (const photo of photos) {
      const section = groups.get(photo.group) || new Map<string, { label: string; items: PhotoItem[] }>();
      const subsection = section.get(photo.fieldName);
      if (subsection) {
        subsection.items.push(photo);
      } else {
        section.set(photo.fieldName, { label: photo.label, items: [photo] });
      }
      groups.set(photo.group, section);
    }
    return (["vehicle", "vac4"] as const).map((groupKey) => {
      const section = groups.get(groupKey) || new Map<string, { label: string; items: PhotoItem[] }>();
      return {
        group: groupKey,
        title: PHOTO_GROUP_TITLES[groupKey],
        subsections: Array.from(section.entries()).map(([fieldName, value]) => ({
          fieldName,
          label: value.label,
          items: value.items,
        })),
      };
    });
  }, [photos]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-5xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Photo Gallery</h1>
          <p className="mt-1 text-sm text-gray-600">Submission ID: {submissionId || "—"}</p>
          <Link
            href="/submitted"
            className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
          >
            Back to Submitted Job Cards
          </Link>
        </header>

        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 text-sm text-amber-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            Could not load photos: {loadError}
          </section>
        ) : null}

        {!loadError && photos.length === 0 ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            No photos found for this submission
          </section>
        ) : null}

        {grouped
          .filter((group) => group.subsections.length > 0)
          .map((group) => (
          <section
            key={group.group}
            className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
          >
            <h2 className="text-lg font-semibold text-gray-900">{group.title}</h2>
            <div className="mt-3 space-y-4">
              {group.subsections.map((subsection) => (
                <div key={`${group.group}-${subsection.fieldName}`}>
                  <h3 className="text-sm font-semibold text-gray-700">{subsection.label}</h3>
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {subsection.items.map((photo) => (
                      <a
                        key={`${photo.storagePath}-${photo.filename}`}
                        href={photo.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-gray-200 bg-white p-2 transition hover:border-blue-300"
                        title="Open full-size image"
                      >
                        <img src={photo.publicUrl} alt={photo.filename} className="h-28 w-full rounded-md object-cover" />
                        <p className="mt-1 truncate text-xs text-gray-700" title={photo.filename}>
                          {photo.filename}
                        </p>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
