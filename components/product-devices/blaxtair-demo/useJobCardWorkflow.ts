"use client";

/**
 * The full-job-card workflow state: reducer + local persistence + all duplicate-check
 * orchestration (photo reuse, device reuse, draft conflicts, revision-chain awareness).
 * Kept as one hook so Equipment/PhotoGallery/Review sections share identical check logic —
 * a photo already used as a power-connection image can't come back as a camera-label photo
 * either, and that's much easier to guarantee from one place than three.
 */
import { useEffect, useMemo, useReducer, useState } from "react";
import type { InstalledProductComponent } from "@/lib/product-devices";
import {
  computeJobCardValidation,
  createEmptyJobCard,
  findDuplicateFingerprintInJobCard,
  type BlaxtairDemoJobCard,
  type BlaxtairJobCardPhoto,
  type ValidationIssue,
} from "@/lib/prototype/blaxtair-job-card";
import {
  findMatchingOtherDraft,
  loadDrafts,
  removeDraft as removeDraftFromList,
  saveDrafts,
  upsertDraft,
} from "@/lib/prototype/blaxtair-draft-store";
import {
  createCorrectedRevision,
  findCrossSubmissionPhotoReuse,
  getCurrentRevision,
  getRevisionChainIds,
  isSuperseded,
  loadSubmissions,
  saveSubmissions,
} from "@/lib/prototype/blaxtair-submission-store";
import { findDuplicateDeviceInSystem, normalizeDeviceKey } from "@/lib/prototype/label-scan/blaxtair-draft";
import {
  appendInstallationEvents,
  findCrossFormInstall,
  loadInstallationHistory,
  saveInstallationHistory,
  type DeviceInstallationEvent,
} from "@/lib/prototype/label-scan/blaxtair-install-registry";
import { loadPhotoUseRegistry, savePhotoUseRegistry, upsertPhotoUseRecords, type PhotoUseRecord } from "@/lib/prototype/photo-dedup-registry";
import { loadValidationMode, saveValidationMode, type ValidationMode } from "@/lib/prototype/blaxtair-validation-mode";
import { jobCardReducer, type JobCardAction } from "./jobCardReducer";

export type DraftConflictPrompt = {
  otherDraftId: string;
  message: string;
  onContinuePrevious: () => void;
  onDiscardPreviousAndContinueHere: () => void;
};

export type ReinstallPrompt = {
  record: DeviceInstallationEvent;
  onConfirm: () => void;
};

function newId(): string {
  return crypto.randomUUID();
}

export function useJobCardWorkflow() {
  const [drafts, setDrafts] = useState<BlaxtairDemoJobCard[]>(() => loadDrafts());
  const [submissions, setSubmissions] = useState<BlaxtairDemoJobCard[]>(() => loadSubmissions());
  const [jobCard, dispatch] = useReducer(jobCardReducer, undefined, () => drafts[0] ?? createEmptyJobCard(newId()));
  const [storeError, setStoreError] = useState<string | null>(null);
  const [draftConflict, setDraftConflict] = useState<DraftConflictPrompt | null>(null);
  const [reinstallPrompt, setReinstallPrompt] = useState<ReinstallPrompt | null>(null);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const [validationMode, setValidationModeState] = useState<ValidationMode>(() => loadValidationMode());

  function setValidationMode(mode: ValidationMode) {
    setValidationModeState(mode);
    saveValidationMode(mode);
  }

  // Persist the active draft whenever it changes.
  useEffect(() => {
    if (jobCard.status !== "draft") return;
    const nextDrafts = upsertDraft(drafts, jobCard);
    const result = saveDrafts(nextDrafts);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reporting this effect's own write outcome
    setStoreError(result.ok ? null : (result.error ?? null));
    setDrafts(nextDrafts);
    // Intentionally omitting `drafts` — this effect both reads and writes it; including it would
    // create a feedback loop. jobCard is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobCard]);

  const otherDrafts = useMemo(() => drafts.filter((d) => d.id !== jobCard.id), [drafts, jobCard.id]);
  const chainIds = useMemo(
    () => getRevisionChainIds(submissions, jobCard.revision.originalSubmissionId ?? jobCard.id),
    [submissions, jobCard.id, jobCard.revision.originalSubmissionId],
  );
  const currentRevision = useMemo(
    () => getCurrentRevision(submissions, jobCard.revision.originalSubmissionId ?? jobCard.id),
    [submissions, jobCard.id, jobCard.revision.originalSubmissionId],
  );

  function dispatchAndClearMessages(action: JobCardAction) {
    setBlockMessage(null);
    dispatch(action);
  }

  /**
   * Full photo-reuse check + attach, in the order the product spec requires:
   * same-form (whole job card) -> other-draft match (prompt) -> same-chain (allow) ->
   * unrelated completed submission (block).
   */
  function checkPhotoAndProceed(args: {
    fingerprint: string;
    excludeId: string;
    onProceed: () => void;
  }): boolean {
    const sameForm = findDuplicateFingerprintInJobCard(jobCard, args.excludeId, args.fingerprint);
    if (sameForm) {
      setBlockMessage("This photo has already been added to this job card. Please use a different photo.");
      return false;
    }

    const draftMatch = findMatchingOtherDraft(otherDrafts, { excludeId: jobCard.id, fingerprint: args.fingerprint });
    if (draftMatch) {
      setDraftConflict({
        otherDraftId: draftMatch.id,
        message:
          "Some of this information already exists in a saved draft for this installation. Would you like to continue the previous draft or discard it and continue here?",
        onContinuePrevious: () => {
          dispatch({ type: "LOAD", card: draftMatch });
          setDraftConflict(null);
        },
        onDiscardPreviousAndContinueHere: () => {
          const next = removeDraftFromList(drafts, draftMatch.id);
          setDrafts(next);
          saveDrafts(next);
          setDraftConflict(null);
          args.onProceed();
        },
      });
      return false;
    }

    // Same-chain matches (a revision inheriting its own original's photos) are allowed —
    // chainIds already covers the current job card itself, so nothing further to check there.
    const crossMatch = findCrossSubmissionPhotoReuse(submissions, args.fingerprint, chainIds);
    if (crossMatch) {
      setBlockMessage(
        "This photo was previously submitted on another job card. Please take or select a new photo showing this installation.",
      );
      return false;
    }

    setBlockMessage(null);
    args.onProceed();
    return true;
  }

  /**
   * Full device-reuse check + confirm, in spec order: same-form (part+serial) -> other-draft
   * match (prompt) -> prior-installation-history (ask transfer/reinstall). Chain-allow for
   * devices falls out naturally: equipment.id stays constant across a revision chain (a
   * revision is the same physical install), so the installation-history check below already
   * excludes the chain's own prior events without extra bookkeeping.
   */
  function checkDeviceAndProceed(args: {
    partNumber: string;
    serialNumber: string;
    excludeComponentId: string;
    onProceed: (reinstallPatch?: Partial<InstalledProductComponent>) => void;
  }): string | null {
    const components = jobCard.equipment?.components ?? [];
    const sameForm = findDuplicateDeviceInSystem(components, args.excludeComponentId, args.partNumber, args.serialNumber);
    if (sameForm) {
      return `This camera (PN: ${args.partNumber}, SN: ${args.serialNumber}) is already used for ${sameForm.componentLabel} on this form. Retake, or use a different camera.`;
    }

    const draftMatch = findMatchingOtherDraft(otherDrafts, {
      excludeId: jobCard.id,
      partNumber: args.partNumber,
      serialNumber: args.serialNumber,
    });
    if (draftMatch) {
      setDraftConflict({
        otherDraftId: draftMatch.id,
        message:
          "Some of this information already exists in a saved draft for this installation. Would you like to continue the previous draft or discard it and continue here?",
        onContinuePrevious: () => {
          dispatch({ type: "LOAD", card: draftMatch });
          setDraftConflict(null);
        },
        onDiscardPreviousAndContinueHere: () => {
          const next = removeDraftFromList(drafts, draftMatch.id);
          setDrafts(next);
          saveDrafts(next);
          setDraftConflict(null);
          args.onProceed();
        },
      });
      return null;
    }

    if (!jobCard.equipment) {
      args.onProceed();
      return null;
    }
    const match = findCrossFormInstall(loadInstallationHistory(), {
      serialNumber: args.serialNumber,
      partNumber: args.partNumber,
      excludeSystemId: jobCard.equipment.id,
    });
    if (!match) {
      args.onProceed();
      return null;
    }
    setReinstallPrompt({
      record: match,
      onConfirm: () => {
        args.onProceed({
          installDetails: {
            reinstalledFromPreviousForm: true,
            previousInstall: {
              systemId: match.systemId,
              componentLabel: match.componentLabel,
              installedAt: match.installedAt,
            },
          },
        });
        setReinstallPrompt(null);
      },
    });
    return null;
  }

  function addPhoto(photo: Omit<BlaxtairJobCardPhoto, "id">) {
    checkPhotoAndProceed({
      fingerprint: photo.contentFingerprint,
      excludeId: "",
      onProceed: () => dispatchAndClearMessages({ type: "ADD_PHOTO", photo: { ...photo, id: newId() } }),
    });
  }

  function replacePhoto(id: string, photo: Omit<BlaxtairJobCardPhoto, "id">) {
    checkPhotoAndProceed({
      fingerprint: photo.contentFingerprint,
      excludeId: id,
      onProceed: () => dispatchAndClearMessages({ type: "UPDATE_PHOTO", id, patch: photo }),
    });
  }

  function removePhoto(id: string) {
    dispatchAndClearMessages({ type: "REMOVE_PHOTO", id });
  }

  function startNewDemoJob() {
    dispatch({ type: "LOAD", card: createEmptyJobCard(newId()) });
    setBlockMessage(null);
    setDraftConflict(null);
    setReinstallPrompt(null);
  }

  function discardCurrentDraft() {
    const next = removeDraftFromList(drafts, jobCard.id);
    setDrafts(next);
    saveDrafts(next);
    startNewDemoJob();
  }

  function resumeDraft(id: string) {
    const draft = drafts.find((d) => d.id === id);
    if (draft) dispatch({ type: "LOAD", card: draft });
  }

  /**
   * Complete Demo Submission: moves the record from drafts to submissions, seeds history/
   * registries. In "technician_strict" validation mode, refuses (and returns the blocking
   * issues instead) when required fields/photos are missing — this is the demo-only gate
   * described in docs/Blaxtair_Demo_Full_Job_Card.md; production enforcement is server-side
   * and driven by company/project form config, not this client toggle.
   */
  function completeDemoSubmission(): {
    deviceCount: number;
    photoCount: number;
    errors: string[];
    blockingIssues: ValidationIssue[];
  } {
    if (validationMode === "technician_strict") {
      const { required } = computeJobCardValidation(jobCard);
      if (required.length > 0) {
        return { deviceCount: 0, photoCount: 0, errors: [], blockingIssues: required };
      }
    }

    const now = new Date().toISOString();
    const completed: BlaxtairDemoJobCard = { ...jobCard, status: "completed", completedAt: now, updatedAt: now };

    const nextSubmissions = [...submissions, completed];
    const submissionResult = saveSubmissions(nextSubmissions);
    setSubmissions(nextSubmissions);

    const nextDrafts = removeDraftFromList(drafts, jobCard.id);
    setDrafts(nextDrafts);
    saveDrafts(nextDrafts);

    const equipmentComponents = completed.equipment?.components ?? [];
    const deviceEvents: DeviceInstallationEvent[] = equipmentComponents
      .filter((c) => (c.identifiers.serialNumber ?? "").trim())
      .map((c) => {
        const reinstalled = c.installDetails?.reinstalledFromPreviousForm === true;
        const previousInstall = c.installDetails?.previousInstall as { systemId?: string } | undefined;
        return {
          id: newId(),
          systemId: completed.equipment!.id,
          componentId: c.id,
          componentLabel: c.componentLabel,
          partNumber: c.identifiers.partNumber ?? "",
          serialNumber: c.identifiers.serialNumber ?? "",
          status: reinstalled ? "reinstalled" : ("installed" as const),
          installedAt: now,
          previousSystemId: reinstalled ? (previousInstall?.systemId ?? null) : null,
        };
      });
    const historyResult = saveInstallationHistory(appendInstallationEvents(loadInstallationHistory(), deviceEvents));

    const photoRecords: PhotoUseRecord[] = [
      ...completed.photos.map((p) => ({
        fingerprint: p.contentFingerprint,
        jobCardId: completed.id,
        category: p.category,
        fieldLabel: p.label,
        usedAt: now,
      })),
      ...equipmentComponents
        .filter((c) => (c.labelPhoto?.contentFingerprint ?? "").trim())
        .map((c) => ({
          fingerprint: c.labelPhoto!.contentFingerprint!,
          jobCardId: completed.id,
          category: "device_label" as const,
          fieldLabel: `${c.componentLabel} label`,
          usedAt: now,
        })),
    ].filter((r) => r.fingerprint.trim());
    const photoRegistryResult = savePhotoUseRegistry(upsertPhotoUseRecords(loadPhotoUseRegistry(), photoRecords));

    const errors = [submissionResult.error, historyResult.error, photoRegistryResult.error].filter(
      (e): e is string => Boolean(e),
    );
    if (errors.length) setStoreError(errors.join(" "));

    dispatch({ type: "LOAD", card: completed });
    return { deviceCount: deviceEvents.length, photoCount: photoRecords.length, errors, blockingIssues: [] };
  }

  function startCorrectedRevision(original: BlaxtairDemoJobCard, args: { reason: string; revisedBy: string }) {
    const revision = createCorrectedRevision(original, { newId: newId(), reason: args.reason, revisedBy: args.revisedBy });
    const nextDrafts = upsertDraft(drafts, revision);
    setDrafts(nextDrafts);
    saveDrafts(nextDrafts);
    dispatch({ type: "LOAD", card: revision });
  }

  return {
    jobCard,
    dispatch: dispatchAndClearMessages,
    drafts,
    submissions,
    storeError,
    draftConflict,
    dismissDraftConflict: () => setDraftConflict(null),
    reinstallPrompt,
    setReinstallPrompt,
    blockMessage,
    setBlockMessage,
    chainIds,
    currentRevision,
    isSuperseded: (card: BlaxtairDemoJobCard) => isSuperseded(submissions, card),
    checkPhotoAndProceed,
    checkDeviceAndProceed,
    addPhoto,
    replacePhoto,
    removePhoto,
    startNewDemoJob,
    discardCurrentDraft,
    resumeDraft,
    completeDemoSubmission,
    startCorrectedRevision,
    normalizeDeviceKey,
    validationMode,
    setValidationMode,
  };
}
