"use client";

/**
 * Blaxtair SSC Speed section — simple photo + manual-entry fields (no OCR yet; see
 * docs note in the equipment section header comment). Renders when the selected product
 * resolves to "Speed SSC" (blaxtair_ssc_speed), wired in app/page.tsx.
 */
import type { ChangeEvent, ReactNode } from "react";
import {
  PhotoFieldError,
  PhotoThumbnailGrid,
  PhotoUploadedBadge,
  PhotoUploadFeedback,
  PHOTO_UPLOAD_LABEL_SINGLE,
  RequiredMark,
} from "@/components/JobCardPhotoControls";
import type { BlaxtairPhotoSlot } from "@/components/product-devices/BlaxtairAhdEquipmentSection";

/** Temporarily hidden for the initial production Blaxtair launch — re-enable when ready. */
const SSC_CONFIG_FILE_UPLOAD_ENABLED = false;

export type SscSpeedFieldState = {
  connectionType: "" | "CAN" | "Hardwire";
  powerDescription: string;
  groundDescription: string;
  ignitionDescription: string;
  speedSignalDescription: string;
  hasDirectionSignal: boolean;
  directionDescription: string;
};

export type SscPhotoSlotKey =
  | "sscLabel"
  | "sscPower"
  | "sscGround"
  | "sscIgnition"
  | "sscCanConnection"
  | "sscSpeedSignal"
  | "sscDirection"
  | "sscMounting"
  | "sscWirePath";

function PhotoBlock(props: {
  label: string;
  required: boolean;
  highlightKey: string;
  photoSlot: BlaxtairPhotoSlot;
  photoPickClass: (key: string, required: boolean, complete: boolean) => string;
  fieldLabelClass: (key: string) => string;
  requiredHint: (key: string) => ReactNode;
  /** Gallery field (e.g. wire path) — allows multiple photos instead of a single "replace" slot. */
  multi?: boolean;
}) {
  return (
    <div id={`field-photo-${props.highlightKey}`}>
      <label className={props.fieldLabelClass(props.highlightKey)}>
        {props.label}
        {props.required ? <RequiredMark /> : null}
      </label>
      <input
        id={`ssc-photo-${props.highlightKey}`}
        type="file"
        className="hidden"
        accept="image/png,image/jpeg,image/jpg"
        multiple={props.multi}
        onChange={props.photoSlot.onUpload}
      />
      <label
        htmlFor={`ssc-photo-${props.highlightKey}`}
        className={props.photoPickClass(props.highlightKey, props.required, (props.photoSlot.uploadedCount ?? 0) >= 1)}
      >
        {props.multi ? "Take or upload photos" : PHOTO_UPLOAD_LABEL_SINGLE}
      </label>
      <PhotoUploadFeedback count={props.photoSlot.uploadedCount} names={props.photoSlot.remoteThumbs.map((r) => r.filename)} />
      <PhotoThumbnailGrid
        files={props.photoSlot.files}
        remotePhotos={props.photoSlot.remoteThumbs}
        onRemoveLocal={props.photoSlot.onRemoveLocal}
        onRemoveRemote={props.photoSlot.onRemoveRemote}
      />
      <PhotoUploadedBadge show={(props.photoSlot.uploadedCount ?? 0) >= 1} status={props.photoSlot.persistStatus} />
      <PhotoFieldError message={props.photoSlot.error} />
      {props.requiredHint(props.highlightKey)}
    </div>
  );
}

export function BlaxtairSscSpeedSection(props: {
  value: SscSpeedFieldState;
  onChange: <K extends keyof SscSpeedFieldState>(field: K, value: SscSpeedFieldState[K]) => void;
  getPhotoSlot: (key: SscPhotoSlotKey) => BlaxtairPhotoSlot;
  configFile: { originalFileName: string; downloadUrl?: string } | null;
  configFileUploading: boolean;
  configFileError: string | null;
  onConfigFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  fieldLabelClass: (key: string) => string;
  fieldInputClass: (key: string) => string;
  fieldSelectClass: (key: string) => string;
  photoPickClass: (key: string, required: boolean, complete: boolean) => string;
  requiredHint: (key: string) => ReactNode;
}) {
  const { value } = props;

  return (
    <div className="space-y-6">
      <PhotoBlock
        label="Label photo"
        required
        highlightKey="ssc-label"
        photoSlot={props.getPhotoSlot("sscLabel")}
        photoPickClass={props.photoPickClass}
        fieldLabelClass={props.fieldLabelClass}
        requiredHint={props.requiredHint}
      />

      {(
        [
          { key: "power", label: "Power connection", photoKey: "sscPower" as const, field: "powerDescription" as const },
          { key: "ground", label: "Ground connection", photoKey: "sscGround" as const, field: "groundDescription" as const },
          { key: "ignition", label: "Ignition connection", photoKey: "sscIgnition" as const, field: "ignitionDescription" as const },
        ]
      ).map((conn) => (
        <div key={conn.key} className="rounded-2xl border-2 border-slate-200 bg-slate-50/80 p-4 dark:border-slate-600 dark:bg-slate-900/50 sm:p-5">
          <p className="mb-3 text-base font-bold text-gray-900 dark:text-gray-100">{conn.label}</p>
          <PhotoBlock
            label={`${conn.label} photo`}
            required
            highlightKey={`ssc-${conn.key}`}
            photoSlot={props.getPhotoSlot(conn.photoKey)}
            photoPickClass={props.photoPickClass}
            fieldLabelClass={props.fieldLabelClass}
            requiredHint={props.requiredHint}
          />
          <div className="mt-3" id={`field-ssc-${conn.key}-description`}>
            <label className={props.fieldLabelClass(`ssc-${conn.key}-description`)}>
              Description
              <RequiredMark />
            </label>
            <input
              className={props.fieldInputClass(`ssc-${conn.key}-description`)}
              placeholder="Describe the connection point"
              value={value[conn.field]}
              onChange={(e) => props.onChange(conn.field, e.target.value)}
            />
            {props.requiredHint(`ssc-${conn.key}-description`)}
          </div>
        </div>
      ))}

      <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/80 p-4 dark:border-slate-600 dark:bg-slate-900/50 sm:p-5">
        <div id="field-ssc-connectionType">
          <label className={props.fieldLabelClass("ssc-connectionType")}>
            Is the device connected via CAN or hardwire?
            <RequiredMark />
          </label>
          <select
            className={props.fieldSelectClass("ssc-connectionType")}
            value={value.connectionType}
            onChange={(e) => props.onChange("connectionType", e.target.value as SscSpeedFieldState["connectionType"])}
          >
            <option value="">Select</option>
            <option value="CAN">CAN</option>
            <option value="Hardwire">Hardwire</option>
          </select>
          {props.requiredHint("ssc-connectionType")}
        </div>

        {value.connectionType === "CAN" ? (
          <div className="mt-4">
            <PhotoBlock
              label="CAN connection photo"
              required
              highlightKey="ssc-canConnection"
              photoSlot={props.getPhotoSlot("sscCanConnection")}
              photoPickClass={props.photoPickClass}
              fieldLabelClass={props.fieldLabelClass}
              requiredHint={props.requiredHint}
            />
          </div>
        ) : null}

        {value.connectionType === "Hardwire" ? (
          <div className="mt-4 space-y-4">
            <PhotoBlock
              label="Speed signal connection photo"
              required
              highlightKey="ssc-speedSignal"
              photoSlot={props.getPhotoSlot("sscSpeedSignal")}
              photoPickClass={props.photoPickClass}
              fieldLabelClass={props.fieldLabelClass}
              requiredHint={props.requiredHint}
            />
            <div id="field-ssc-speedSignal-description">
              <label className={props.fieldLabelClass("ssc-speedSignal-description")}>
                Speed signal description
                <RequiredMark />
              </label>
              <input
                className={props.fieldInputClass("ssc-speedSignal-description")}
                placeholder="Describe the speed signal connection"
                value={value.speedSignalDescription}
                onChange={(e) => props.onChange("speedSignalDescription", e.target.value)}
              />
              {props.requiredHint("ssc-speedSignal-description")}
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input
                type="checkbox"
                checked={value.hasDirectionSignal}
                onChange={(e) => props.onChange("hasDirectionSignal", e.target.checked)}
              />
              This installation has a direction signal
            </label>
            {value.hasDirectionSignal ? (
              <>
                <PhotoBlock
                  label="Direction signal connection photo"
                  required
                  highlightKey="ssc-direction"
                  photoSlot={props.getPhotoSlot("sscDirection")}
                  photoPickClass={props.photoPickClass}
                  fieldLabelClass={props.fieldLabelClass}
                  requiredHint={props.requiredHint}
                />
                <div id="field-ssc-direction-description">
                  <label className={props.fieldLabelClass("ssc-direction-description")}>
                    Direction signal description
                    <RequiredMark />
                  </label>
                  <input
                    className={props.fieldInputClass("ssc-direction-description")}
                    placeholder="Describe the direction signal connection"
                    value={value.directionDescription}
                    onChange={(e) => props.onChange("directionDescription", e.target.value)}
                  />
                  {props.requiredHint("ssc-direction-description")}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <PhotoBlock
        label="Mounting photo"
        required
        highlightKey="ssc-mounting"
        photoSlot={props.getPhotoSlot("sscMounting")}
        photoPickClass={props.photoPickClass}
        fieldLabelClass={props.fieldLabelClass}
        requiredHint={props.requiredHint}
      />

      <PhotoBlock
        label="Wire path photo(s)"
        required
        multi
        highlightKey="ssc-wirePath"
        photoSlot={props.getPhotoSlot("sscWirePath")}
        photoPickClass={props.photoPickClass}
        fieldLabelClass={props.fieldLabelClass}
        requiredHint={props.requiredHint}
      />

      {SSC_CONFIG_FILE_UPLOAD_ENABLED ? (
        <div id="field-ssc-configFile">
          <label className={props.fieldLabelClass("ssc-configFile")}>
            Configuration file
            <RequiredMark />
          </label>
          <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
            Renamed on upload to match this job&apos;s site and asset number.
          </p>
          <input id="ssc-config-file-input" type="file" className="hidden" onChange={props.onConfigFileChange} />
          <label htmlFor="ssc-config-file-input" className={props.photoPickClass("ssc-configFile", true, !!props.configFile)}>
            {props.configFileUploading ? "Uploading…" : props.configFile ? "Replace file" : "Upload file"}
          </label>
          {props.configFile ? (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">Uploaded: {props.configFile.originalFileName}</p>
          ) : null}
          {props.configFileError ? <PhotoFieldError message={props.configFileError} /> : null}
          {props.requiredHint("ssc-configFile")}
        </div>
      ) : null}
    </div>
  );
}
