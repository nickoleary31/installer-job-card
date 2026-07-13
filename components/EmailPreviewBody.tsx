"use client";

import type { EmailViewModel } from "@/lib/email-view-model";

/** Structured email preview (matches outbound layout; photos use app URLs only). */
export function EmailPreviewBody({ model }: { model: EmailViewModel }) {
  return (
    <div className="space-y-4 text-sm text-gray-900">
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <iframe
          title="Email preview"
          srcDoc={model.htmlBody}
          className="h-[min(50vh,28rem)] w-full border-0"
          sandbox=""
        />
      </div>

      <details className="rounded-lg border border-gray-200 bg-white p-3">
        <summary className="cursor-pointer font-semibold text-gray-800">Plain-text fallback</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-gray-700">{model.textBody}</pre>
      </details>

      {model.photoGalleryUrl ? (
        <p className="text-xs text-gray-500">
          App gallery (not included in client email):{" "}
          <a href={model.photoGalleryUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline">
            Open photos
          </a>
        </p>
      ) : null}
    </div>
  );
}
