"use client";

import { useRef, type ReactNode } from "react";
import type { ProductFileDefinition, ProductFileUploadSlot } from "@/lib/product-files";
import { validateProductFile } from "@/lib/product-files";

type Props = {
  productKey: string;
  productLabel: string;
  definition: ProductFileDefinition;
  slot: ProductFileUploadSlot | undefined;
  isOffline?: boolean;
  highlight?: boolean;
  /** DOM id for scroll-to-highlight (defaults to field-product-file-...). */
  fieldDomId?: string;
  requiredHint?: ReactNode;
  onChange: (slot: ProductFileUploadSlot) => void;
  onValidationError?: (message: string) => void;
  onClearHighlight?: () => void;
  secondaryButtonClassName: string;
  fieldLabelClassName: string;
};

export function ProductFileUpload(props: Props) {
  const {
    productKey,
    productLabel,
    definition,
    slot,
    isOffline,
    highlight,
    fieldDomId,
    requiredHint,
    onChange,
    onValidationError,
    onClearHighlight,
    secondaryButtonClassName,
    fieldLabelClassName,
  } = props;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const fieldId = fieldDomId || `field-product-file-${productKey}-${definition.key}`;
  const accept = [...definition.acceptedExtensions, ...definition.acceptedMimeTypes].join(",");

  const localFiles = slot?.localFiles ?? [];
  const uploaded = slot?.uploaded ?? [];
  const hasFile = localFiles.length > 0 || uploaded.length > 0;

  const emptySlot = (): ProductFileUploadSlot => ({
    fileKey: definition.key,
    productKey,
    localFiles: [],
    uploaded: [],
  });

  const applyFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const accepted: File[] = [];
    for (const file of list) {
      const result = validateProductFile(file, definition);
      if (!result.ok) {
        onValidationError?.(result.message);
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      accepted.push(file);
    }
    const nextFiles = definition.multiple ? [...localFiles, ...accepted] : [accepted[0]!];
    onChange({
      ...(slot || emptySlot()),
      fileKey: definition.key,
      productKey,
      localFiles: nextFiles,
      uploaded: definition.multiple ? uploaded : [],
    });
    onClearHighlight?.();
  };

  const removeAll = () => {
    onChange({
      ...(slot || emptySlot()),
      localFiles: [],
      uploaded: [],
    });
    if (inputRef.current) inputRef.current.value = "";
    onClearHighlight?.();
  };

  return (
    <div
      id={fieldId}
      className={`space-y-4 rounded-2xl border-2 p-4 sm:p-5 ${
        highlight
          ? "border-red-400 bg-red-50/60 dark:border-red-700 dark:bg-red-950/30"
          : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30"
      }`}
    >
      <div>
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{definition.label}</p>
        <p className="mt-1 text-xs font-medium text-gray-500 dark:text-gray-400">{productLabel}</p>
        {definition.description ? (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{definition.description}</p>
        ) : null}
      </div>

      {isOffline ? (
        <p
          id={fieldDomId === "field-ppd-jsonFile" ? "field-ppd-jsonOffline" : undefined}
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
          role="status"
        >
          Cloud upload requires an online connection. You can still choose a file now — it will be saved with this device
          draft.
        </p>
      ) : null}

      <div>
        <label className={fieldLabelClassName}>
          {definition.label}
          {definition.required ? <span className="text-red-600"> *</span> : null}
        </label>
        <input
          ref={inputRef}
          type="file"
          accept={accept || undefined}
          multiple={definition.multiple}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) applyFiles(e.target.files);
          }}
        />
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button type="button" className={secondaryButtonClassName} onClick={() => inputRef.current?.click()}>
            {definition.multiple ? "Choose files" : "Choose file"}
          </button>
          <p className="text-sm text-gray-800 dark:text-gray-200">
            {localFiles.length > 0 ? (
              <span className="font-semibold">{localFiles.map((f) => f.name).join(", ")}</span>
            ) : uploaded.length > 0 ? (
              <span className="font-semibold">
                Already uploaded: {uploaded.map((u) => u.originalFileName).join(", ")}
              </span>
            ) : (
              <span className="text-gray-500 dark:text-gray-400">No file selected</span>
            )}
          </p>
          {hasFile ? (
            <button
              type="button"
              className="text-sm font-semibold text-red-700 underline dark:text-red-400"
              onClick={removeAll}
            >
              Remove
            </button>
          ) : null}
        </div>
        {requiredHint}
      </div>
    </div>
  );
}

export function emptyProductFileSlot(productKey: string, fileKey: string): ProductFileUploadSlot {
  return {
    fileKey,
    productKey,
    localFiles: [],
    uploaded: [],
  };
}
