import { isNativeRuntime } from "./runtime";

/**
 * Boundary interface only (Phase 1A). Not wired into the job-card photo UI yet —
 * that UI still uses plain `<input type="file">` elements directly. This exists
 * so future native camera work has a seam to implement against instead of the
 * shared form code importing Capacitor plugins directly.
 */
export type CapturedPhoto = {
  blob: Blob;
  fileName: string;
  mimeType: string;
};

export interface CameraService {
  /** Prompts the user to take or choose a photo. Resolves to null if cancelled. */
  capturePhoto(): Promise<CapturedPhoto | null>;
}

/** Reuses the browser's native file-picker sheet (same mechanism the job-card form uses today). */
class WebCameraService implements CameraService {
  capturePhoto(): Promise<CapturedPhoto | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        resolve(file ? { blob: file, fileName: file.name, mimeType: file.type } : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }
}

/** Phase 1B/2: back this with @capacitor/camera for a true native capture sheet + gallery access. */
class NativeCameraServiceNotImplemented implements CameraService {
  capturePhoto(): Promise<CapturedPhoto | null> {
    throw new Error(
      "Native camera capture is not implemented yet (Phase 1A only established the boundary). Install and wire @capacitor/camera in a later phase.",
    );
  }
}

export function getCameraService(): CameraService {
  return isNativeRuntime() ? new NativeCameraServiceNotImplemented() : new WebCameraService();
}
