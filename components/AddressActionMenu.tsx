"use client";

import { useEffect, useRef, useState } from "react";
import { buildAppleMapsUrl, buildGoogleMapsUrl, buildWazeUrl, toSingleLineAddress } from "@/lib/address";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy fallback below
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

const actionButtonClassName =
  "flex min-h-[48px] w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-3 text-base font-semibold text-gray-900 hover:bg-gray-50 active:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700";

const cancelButtonClassName =
  "flex min-h-[48px] w-full items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-base font-semibold text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800";

export type AddressActionMenuProps = {
  /** The address exactly as stored — may be multiline. Rendered as-is (whitespace preserved). */
  address: string;
  className?: string;
};

/**
 * Renders a stored (possibly multiline) address; tapping/clicking it opens an action sheet with
 * Copy Address / Open in Google Maps / Open in Apple Maps / Open in Waze / Cancel. Map links are
 * plain provider web URLs (also valid deep links — the OS/browser routes into the native app when
 * installed and falls back to the web result otherwise), so this never calls a Maps API, never
 * geocodes, and needs no API key. The one-line address used for copy/map actions is derived only
 * for this purpose and never replaces the stored multiline value shown on the page.
 */
export function AddressActionMenu({ address, className }: AddressActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimeoutRef = useRef<number | null>(null);

  const trimmed = address.trim();
  const isEmpty = !trimmed || trimmed === "—";

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) window.clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const showFeedback = (message: string) => {
    setFeedback(message);
    if (feedbackTimeoutRef.current) window.clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = window.setTimeout(() => setFeedback(null), 2000);
  };

  const textClassName = className ?? "whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100";

  if (isEmpty) {
    return <p className={textClassName}>—</p>;
  }

  const singleLine = toSingleLineAddress(trimmed);

  const handleCopy = async () => {
    const ok = await copyToClipboard(singleLine);
    setOpen(false);
    showFeedback(ok ? "Address copied" : "Could not copy address");
  };

  const openMapLink = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${textClassName} rounded text-left underline decoration-dotted underline-offset-2 hover:text-blue-700 dark:hover:text-blue-400`}
      >
        {trimmed}
      </button>
      {feedback ? <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">{feedback}</p> : null}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Address actions"
            className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="mb-3 whitespace-pre-wrap text-sm font-semibold text-gray-900 dark:text-gray-100">{trimmed}</p>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => void handleCopy()} className={actionButtonClassName}>
                Copy Address
              </button>
              <button type="button" onClick={() => openMapLink(buildGoogleMapsUrl(singleLine))} className={actionButtonClassName}>
                Open in Google Maps
              </button>
              <button type="button" onClick={() => openMapLink(buildAppleMapsUrl(singleLine))} className={actionButtonClassName}>
                Open in Apple Maps
              </button>
              <button type="button" onClick={() => openMapLink(buildWazeUrl(singleLine))} className={actionButtonClassName}>
                Open in Waze
              </button>
              <button type="button" onClick={() => setOpen(false)} className={cancelButtonClassName}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
