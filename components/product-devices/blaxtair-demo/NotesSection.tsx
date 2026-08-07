"use client";

export function NotesSection(props: { value: string; onChange: (value: string) => void }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium text-emerald-200">Technician Notes</h2>
      <label className="block text-sm">
        Anything else about this installation
        <textarea
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          rows={5}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="Access issues, customer requests, follow-up needed, etc."
        />
      </label>
    </section>
  );
}
