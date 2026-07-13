"use client";

import { useEffect, useState } from "react";
import type { EmailViewModel } from "@/lib/email-view-model";
import type { EmailSendMode } from "@/lib/email-recipients";
import { EmailPreviewBody } from "@/components/EmailPreviewBody";

export type EmailRecipientRow = {
  email: string;
  source: string;
  label: string;
  route: "to" | "cc" | "bcc";
  sourceHistory?: Array<{ source: string; label: string }>;
};

type Props = {
  open: boolean;
  title: string;
  confirmLabel: string;
  model: EmailViewModel;
  payload: unknown;
  initialSendMode?: EmailSendMode;
  sending?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onConfirm: (sendMode: EmailSendMode) => void;
};

function RecipientList({ payload, sendMode }: { payload: unknown; sendMode: EmailSendMode }) {
  const [recipients, setRecipients] = useState<EmailRecipientRow[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/email-recipients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload, sendMode }),
        });
        const data = (await res.json()) as { to?: EmailRecipientRow[]; cc?: EmailRecipientRow[]; bcc?: EmailRecipientRow[] };
        if (cancelled) return;
        setRecipients([...(data.to || []), ...(data.cc || []), ...(data.bcc || [])]);
      } catch {
        if (!cancelled) setRecipients([]);
      } finally {
        if (!cancelled) setLoadingRecipients(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payload, sendMode]);

  if (loadingRecipients) {
    return <p className="mt-2 text-sm text-gray-600">Loading recipient list…</p>;
  }
  if (recipients.length === 0) {
    return <p className="mt-2 text-sm text-amber-800">No recipients resolved.</p>;
  }
  return (
    <ul className="mt-3 space-y-2">
      {recipients.map((r) => {
        const extras = (r.sourceHistory || []).filter((h) => h.source !== r.source);
        return (
          <li key={`${r.route}-${r.email}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
            <p className="font-mono font-semibold text-gray-900">{r.email}</p>
            <p className="text-xs text-gray-600">
              {r.route.toUpperCase()} · {r.label}
            </p>
            {extras.length > 0 ? (
              <p className="mt-1 text-xs text-gray-500">
                Also matched: {extras.map((h) => h.label).join("; ")}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function EmailSendConfirmModalBody({
  title,
  confirmLabel,
  model,
  payload,
  initialSendMode,
  sending,
  errorMessage,
  onClose,
  onConfirm,
}: Omit<Props, "open">) {
  const [sendMode, setSendMode] = useState<EmailSendMode>(initialSendMode ?? "client_and_internal");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <p className="mt-1 text-sm text-gray-600">Review recipients and email content before sending.</p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section>
            <h3 className="text-sm font-bold text-gray-900">Send mode</h3>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3">
                <input
                  type="radio"
                  name="sendMode"
                  checked={sendMode === "client_and_internal"}
                  onChange={() => setSendMode("client_and_internal")}
                  className="mt-1"
                />
                <span>
                  <span className="block font-semibold text-gray-900">Email client + internal recipients</span>
                  <span className="text-sm text-gray-600">Includes project/site externals and internal archive addresses.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3">
                <input
                  type="radio"
                  name="sendMode"
                  checked={sendMode === "internal_only"}
                  onChange={() => setSendMode("internal_only")}
                  className="mt-1"
                />
                <span>
                  <span className="block font-semibold text-gray-900">Email internal only</span>
                  <span className="text-sm text-gray-600">Sends only to nick@tkptelematics.com — no client-facing recipients.</span>
                </span>
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-sm font-bold text-gray-900">Recipients</h3>
            <p className="mt-1 text-xs text-gray-600">
              Email mode:{" "}
              <span className="font-semibold">{sendMode === "internal_only" ? "Internal only" : "Client + internal"}</span>
            </p>
            <RecipientList key={sendMode} payload={payload} sendMode={sendMode} />
            <p className="mt-2 text-xs text-gray-500">CC and BCC are not used unless explicitly added later.</p>
          </section>

          <section>
            <h3 className="text-sm font-bold text-gray-900">Subject</h3>
            <p className="mt-1 text-sm text-gray-800">{model.subject}</p>
          </section>

          <section>
            <h3 className="text-sm font-bold text-gray-900">Email preview</h3>
            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <EmailPreviewBody model={model} />
            </div>
          </section>

          {errorMessage ? (
            <p className="whitespace-pre-wrap text-sm font-semibold text-red-700" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
            onClick={() => onConfirm(sendMode)}
            disabled={sending}
          >
            {sending ? "Sending…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmailSendConfirmModal({ open, initialSendMode = "client_and_internal", ...rest }: Props) {
  if (!open) return null;
  return <EmailSendConfirmModalBody key={initialSendMode} initialSendMode={initialSendMode} {...rest} />;
}
