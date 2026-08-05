"use client";

/**
 * Full local demo job-card workflow — job/site, vehicle, equipment (OCR), connections, photos,
 * notes, review, completion, and corrected revisions. Standalone and local-only: no Supabase,
 * no Storage, no Resend, no production job-card connection. See
 * docs/Blaxtair_Demo_Duplicate_Detection.md and docs/Blaxtair_Demo_Full_Job_Card.md.
 */
import { useState } from "react";
import { JOB_CARD_STAGES, type JobCardStage, type ValidationIssue } from "@/lib/prototype/blaxtair-job-card";
import { CompletedSubmissionsSection } from "./blaxtair-demo/CompletedSubmissionsSection";
import { ConnectionDetailsSection } from "./blaxtair-demo/ConnectionDetailsSection";
import { EquipmentSection } from "./blaxtair-demo/EquipmentSection";
import { JobSiteSection } from "./blaxtair-demo/JobSiteSection";
import { NotesSection } from "./blaxtair-demo/NotesSection";
import { PhotoGallerySection } from "./blaxtair-demo/PhotoGallerySection";
import { ReviewSection } from "./blaxtair-demo/ReviewSection";
import { VehicleSection } from "./blaxtair-demo/VehicleSection";
import { useJobCardWorkflow } from "./blaxtair-demo/useJobCardWorkflow";

const STAGE_LABELS: Record<JobCardStage, string> = {
  job_site: "Job / Site",
  vehicle: "Vehicle",
  equipment: "Equipment",
  connections: "Connections",
  photos: "Photos",
  notes: "Notes",
  review: "Review",
};

export function BlaxtairOcrDemoPanel() {
  const wf = useJobCardWorkflow();
  const [view, setView] = useState<"workflow" | "submissions">("workflow");
  const [completeMessage, setCompleteMessage] = useState<string | null>(null);
  const [blockingIssues, setBlockingIssues] = useState<ValidationIssue[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);

  const stageIndex = JOB_CARD_STAGES.indexOf(wf.jobCard.currentStage);

  function goToStage(stage: JobCardStage) {
    wf.dispatch({ type: "SET_STAGE", stage });
    setBlockingIssues([]);
  }

  function startNewDemoJob() {
    if (wf.jobCard.status === "draft" && !window.confirm("Start a new demo job? Your current draft stays saved and can be resumed later.")) {
      return;
    }
    wf.startNewDemoJob();
    setCompleteMessage(null);
    setBlockingIssues([]);
  }

  function discardCurrentDraft() {
    if (!window.confirm("Discard this draft? Everything entered — job/site info, photos, equipment — will be permanently removed from this device.")) {
      return;
    }
    wf.discardCurrentDraft();
    setBlockingIssues([]);
  }

  function resumeDraft(id: string) {
    wf.resumeDraft(id);
    setBlockingIssues([]);
  }

  function handleComplete() {
    const result = wf.completeDemoSubmission();
    if (result.blockingIssues.length > 0) {
      setBlockingIssues(result.blockingIssues);
      setCompleteMessage(null);
      return;
    }
    setBlockingIssues([]);
    setCompleteMessage(
      result.errors.length === 0
        ? `Demo Submission complete (local only — not transmitted). Recorded ${result.deviceCount} device event${result.deviceCount === 1 ? "" : "s"} and ${result.photoCount} photo${result.photoCount === 1 ? "" : "s"}.`
        : result.errors.join(" "),
    );
  }

  if (view === "submissions") {
    return (
      <div className="mx-auto max-w-xl px-4 py-6 space-y-5 text-slate-100">
        <CompletedSubmissionsSection
          submissions={wf.submissions}
          isSuperseded={wf.isSuperseded}
          onStartCorrectedRevision={(original, args) => {
            wf.startCorrectedRevision(original, args);
            setView("workflow");
            setCompleteMessage(null);
          }}
          onClose={() => setView("workflow")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-5 text-slate-100">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-emerald-200">Blaxtair AHD — full demo job card</h1>
        <p className="text-sm text-slate-400">Local prototype. Nothing is uploaded or submitted — this stays on your device.</p>
        <div className="flex flex-wrap gap-3 text-xs">
          <button type="button" className="text-red-300 underline" onClick={startNewDemoJob}>
            Start New Demo Job
          </button>
          <button type="button" className="text-red-300 underline" onClick={discardCurrentDraft}>
            Discard This Draft
          </button>
          <button type="button" className="text-slate-300 underline" onClick={() => setShowDrafts((v) => !v)}>
            Saved Drafts ({wf.drafts.length})
          </button>
          <button type="button" className="text-slate-300 underline" onClick={() => setView("submissions")}>
            Completed Demo Submissions ({wf.submissions.length})
          </button>
        </div>
        {showDrafts ? (
          <div className="space-y-1 rounded border border-slate-700 bg-slate-900/60 p-2 text-xs">
            {wf.drafts.length === 0 ? <p className="text-slate-500">No saved drafts.</p> : null}
            {wf.drafts.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2">
                <span>
                  {d.jobSite.customer || "(no customer)"} — {d.jobSite.siteName || "(no site)"}
                  {d.id === wf.jobCard.id ? " (current)" : ""}
                </span>
                {d.id !== wf.jobCard.id ? (
                  <button type="button" className="text-emerald-300 underline" onClick={() => resumeDraft(d.id)}>
                    Resume
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-1 rounded-lg border border-sky-700/50 bg-sky-950/20 p-2 text-xs">
          <p className="font-medium text-sky-200">
            Demo-only: completion validation mode <span className="text-sky-400">(not a production control)</span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="validation-mode"
                checked={wf.validationMode === "qa_relaxed"}
                onChange={() => {
                  wf.setValidationMode("qa_relaxed");
                  setBlockingIssues([]);
                }}
              />
              QA / relaxed — warns, still allows completion
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="validation-mode"
                checked={wf.validationMode === "technician_strict"}
                onChange={() => {
                  wf.setValidationMode("technician_strict");
                  setBlockingIssues([]);
                }}
              />
              Technician / strict — blocks completion until required items are resolved
            </label>
          </div>
          <p className="text-sky-400">
            In production, validation rules come from the company/project/form configuration and are enforced
            server-side — this toggle exists only so the local demo can show both behaviors.
          </p>
        </div>
      </header>

      {wf.storeError ? <p className="rounded-lg border border-red-700/50 bg-red-950/30 p-3 text-sm text-red-200">{wf.storeError}</p> : null}

      {wf.draftConflict ? (
        <div className="space-y-2 rounded-lg border border-amber-600 bg-amber-950/40 p-3 text-sm text-amber-100">
          <p>{wf.draftConflict.message}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-white" onClick={wf.draftConflict.onContinuePrevious}>
              Continue previous draft
            </button>
            <button type="button" className="rounded-lg border border-slate-500 px-3 py-2" onClick={wf.draftConflict.onDiscardPreviousAndContinueHere}>
              Discard previous draft and continue here
            </button>
            <button type="button" className="rounded-lg border border-slate-500 px-3 py-2" onClick={wf.dismissDraftConflict}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {completeMessage ? (
        <p className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3 text-sm text-emerald-200">{completeMessage}</p>
      ) : null}

      {wf.jobCard.status === "completed" ? (
        <p className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          This demo submission is complete (local-only, not transmitted). Use Completed Demo Submissions to review it or start a corrected revision.
        </p>
      ) : null}

      <nav className="flex flex-wrap gap-2">
        {JOB_CARD_STAGES.map((stage, i) => (
          <button
            key={stage}
            type="button"
            className={`rounded-lg border px-3 py-1 text-xs ${
              stage === wf.jobCard.currentStage ? "border-emerald-400 text-emerald-100" : "border-slate-600 text-slate-300"
            }`}
            onClick={() => goToStage(stage)}
          >
            {i + 1}. {STAGE_LABELS[stage]}
          </button>
        ))}
      </nav>

      {wf.jobCard.currentStage === "job_site" ? (
        <JobSiteSection value={wf.jobCard.jobSite} onChange={(field, value) => wf.dispatch({ type: "SET_JOB_SITE_FIELD", field, value })} />
      ) : null}

      {wf.jobCard.currentStage === "vehicle" ? (
        <VehicleSection value={wf.jobCard.vehicle} onChange={(field, value) => wf.dispatch({ type: "SET_VEHICLE_FIELD", field, value })} />
      ) : null}

      {wf.jobCard.currentStage === "equipment" ? (
        <EquipmentSection
          equipment={wf.jobCard.equipment}
          onChangeEquipment={(equipment) => wf.dispatch({ type: "SET_EQUIPMENT", equipment })}
          checkPhotoAndProceed={wf.checkPhotoAndProceed}
          checkDeviceAndProceed={wf.checkDeviceAndProceed}
          reinstallPrompt={wf.reinstallPrompt}
          onCancelReinstallPrompt={() => wf.setReinstallPrompt(null)}
          blockMessage={wf.blockMessage}
          onClearBlockMessage={() => wf.setBlockMessage(null)}
        />
      ) : null}

      {wf.jobCard.currentStage === "connections" ? (
        <ConnectionDetailsSection
          value={wf.jobCard.installation}
          onChangeConnection={(connection, patch) => wf.dispatch({ type: "SET_CONNECTION", connection, patch })}
          onChangeField={(field, value) => wf.dispatch({ type: "SET_INSTALLATION_FIELD", field, value })}
        />
      ) : null}

      {wf.jobCard.currentStage === "photos" ? (
        <PhotoGallerySection
          jobCard={wf.jobCard}
          onAdd={wf.addPhoto}
          onReplace={wf.replacePhoto}
          onRemove={wf.removePhoto}
          onUpdateDescription={(id, description) => wf.dispatch({ type: "UPDATE_PHOTO", id, patch: { description } })}
          blockMessage={wf.blockMessage}
        />
      ) : null}

      {wf.jobCard.currentStage === "notes" ? (
        <NotesSection value={wf.jobCard.technicianNotes} onChange={(value) => wf.dispatch({ type: "SET_NOTES", value })} />
      ) : null}

      {wf.jobCard.currentStage === "review" ? (
        <ReviewSection jobCard={wf.jobCard} validationMode={wf.validationMode} onJumpTo={goToStage} />
      ) : null}

      {blockingIssues.length ? (
        <div className="space-y-2 rounded-lg border border-red-700/60 bg-red-950/30 p-3 text-sm text-red-200">
          <p className="font-medium">
            Cannot complete — {blockingIssues.length} required item{blockingIssues.length === 1 ? "" : "s"} missing
            (Technician / strict validation):
          </p>
          <ul className="space-y-1">
            {blockingIssues.map((issue, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span>• {issue.message}</span>
                <button
                  type="button"
                  className="shrink-0 whitespace-nowrap text-xs underline underline-offset-2"
                  onClick={() => goToStage(issue.stage)}
                >
                  Go to {STAGE_LABELS[issue.stage]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-slate-700 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          className="rounded-lg border border-slate-500 px-4 py-2 text-sm text-slate-200 disabled:opacity-40"
          disabled={stageIndex <= 0}
          onClick={() => goToStage(JOB_CARD_STAGES[stageIndex - 1]!)}
        >
          Back
        </button>
        {wf.jobCard.currentStage === "review" ? (
          <button
            type="button"
            className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            disabled={wf.jobCard.status === "completed"}
            onClick={handleComplete}
          >
            Complete Demo Submission
          </button>
        ) : (
          <button
            type="button"
            className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            disabled={stageIndex >= JOB_CARD_STAGES.length - 1}
            onClick={() => goToStage(JOB_CARD_STAGES[stageIndex + 1]!)}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

export default BlaxtairOcrDemoPanel;
