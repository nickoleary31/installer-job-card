"use client";

import { BrowserMultiFormatReader } from "@zxing/browser";
import { NotFoundException } from "@zxing/library";
import { useCallback, useEffect, useId, useRef, useState } from "react";

const defaultInputClassName =
  "w-full min-h-[52px] flex-1 px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:focus:border-blue-400 dark:focus:ring-blue-900/40";

const defaultLabelClassName = "block text-gray-900 font-semibold text-base mb-2 dark:text-gray-100";

const btnSecondaryClassName =
  "inline-flex min-h-[52px] shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-blue-600 bg-white px-4 py-3.5 text-base font-semibold text-blue-600 shadow-sm hover:bg-blue-50 active:bg-blue-100 dark:border-blue-500 dark:bg-gray-900 dark:text-blue-400 dark:hover:bg-gray-800 sm:px-5";

const btnCancelClassName =
  "inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-base font-semibold text-gray-800 shadow-sm hover:bg-gray-50 active:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700";

function pickRearCameraDeviceId(devices: MediaDeviceInfo[]): string | undefined {
  const match = devices.find((d) => /back|rear|environment|wide|world/i.test(d.label));
  return match?.deviceId ?? devices[0]?.deviceId;
}

export type SerialInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  /** Override label classes (e.g. parent validation highlight). */
  labelClassName?: string;
  /** Override input classes (e.g. parent `fieldInputClass`). */
  inputClassName?: string;
};

/**
 * Serial / asset ID field with optional QR and barcode scan (camera).
 * Manual entry always remains available; scanner opens only after the user taps Scan.
 */
export function SerialInput({
  label,
  value,
  onChange,
  required,
  placeholder,
  labelClassName: labelClassNameProp,
  inputClassName: inputClassNameProp,
}: SerialInputProps) {
  const labelCn = labelClassNameProp ?? defaultLabelClassName;
  const inputCn = inputClassNameProp ?? defaultInputClassName;
  const id = useId();
  const inputId = `${id}-input`;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const onChangeRef = useRef(onChange);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const closeScanner = useCallback(() => {
    const video = videoRef.current;
    controlsRef.current?.stop();
    controlsRef.current = null;
    if (video) {
      BrowserMultiFormatReader.cleanVideoSource(video);
    }
    setScannerOpen(false);
  }, []);

  useEffect(() => {
    if (!scannerOpen) return;

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    void (async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const deviceId = pickRearCameraDeviceId(devices);

        const controls = await reader.decodeFromVideoDevice(deviceId, video, (result, err, ctl) => {
          if (cancelled) return;
          if (result) {
            const text = result.getText().trim();
            if (text) {
              onChangeRef.current(text);
            }
            ctl.stop();
            BrowserMultiFormatReader.cleanVideoSource(video);
            controlsRef.current = null;
            setScannerOpen(false);
            return;
          }
          if (err && !(err instanceof NotFoundException)) {
            // Transient decode errors are common; do not surface unless camera failed to start.
          }
        });

        if (cancelled) {
          controls.stop();
          BrowserMultiFormatReader.cleanVideoSource(video);
          return;
        }
        controlsRef.current = controls;
      } catch {
        if (!cancelled) {
          setCameraMessage("Camera not available. Enter manually.");
          BrowserMultiFormatReader.cleanVideoSource(video);
          setScannerOpen(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      BrowserMultiFormatReader.cleanVideoSource(video);
    };
  }, [scannerOpen]);

  const handleScanClick = () => {
    setCameraMessage(null);
    setScannerOpen(true);
  };

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className={labelCn}>
        {label}
        {required ? (
          <span className="text-red-600 font-bold dark:text-red-400" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          className={`${inputCn} min-w-0 sm:flex-1`}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {!scannerOpen ? (
          <button type="button" className={btnSecondaryClassName} onClick={handleScanClick}>
            Scan
          </button>
        ) : null}
      </div>

      {scannerOpen ? (
        <div className="mt-2 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-900/60">
          <video
            ref={videoRef}
            className="aspect-video w-full max-h-64 rounded-lg bg-black object-cover"
            muted
            playsInline
            aria-label="Camera preview for scanning"
          />
          <button type="button" className={btnCancelClassName} onClick={closeScanner}>
            Cancel
          </button>
        </div>
      ) : null}

      {cameraMessage ? (
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200" role="status" aria-live="polite">
          {cameraMessage}
        </p>
      ) : null}
    </div>
  );
}
