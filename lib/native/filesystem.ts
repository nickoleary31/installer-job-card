import { isNativeRuntime } from "./runtime.ts";

/**
 * Boundary interface only (Phase 1A/2A). Generic blob storage by key — deliberately
 * has no knowledge of job cards, drafts, or photos. Not wired into any feature yet.
 */
export interface AppFilesystem {
  writeFile(key: string, data: Blob): Promise<void>;
  readFile(key: string): Promise<Blob | null>;
  deleteFile(key: string): Promise<void>;
}

/** Origin Private File System — same-origin durable storage already available in modern browsers/WebViews. */
class WebOpfsFilesystem implements AppFilesystem {
  private async getDir(): Promise<FileSystemDirectoryHandle | null> {
    if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) return null;
    return navigator.storage.getDirectory();
  }

  async writeFile(key: string, data: Blob): Promise<void> {
    const dir = await this.getDir();
    if (!dir) throw new Error("Origin Private File System is not supported in this browser.");
    const handle = await dir.getFileHandle(key, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  async readFile(key: string): Promise<Blob | null> {
    const dir = await this.getDir();
    if (!dir) return null;
    try {
      const handle = await dir.getFileHandle(key);
      return await handle.getFile();
    } catch {
      return null;
    }
  }

  async deleteFile(key: string): Promise<void> {
    const dir = await this.getDir();
    if (!dir) return;
    try {
      await dir.removeEntry(key);
    } catch {
      // already absent
    }
  }
}

/**
 * @capacitor/filesystem accepts/returns Blob only on Web — native read/write is
 * base64-string-only (per its own type definitions), so the native path converts.
 * Pure, so unit-testable without a device — see lib/native/filesystem.test.ts.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes]);
}

/**
 * Dynamically imported inside each method (never at module load) — same
 * maximally-safe pattern as the community plugins in lib/native/database.ts
 * and lib/native/secure-storage.ts, applied uniformly rather than trusting
 * that @capacitor/filesystem's own web implementation is import-safe
 * everywhere this file gets pulled in (root Next build, SSR, plain browser).
 */
class NativeCapacitorFilesystem implements AppFilesystem {
  async writeFile(key: string, data: Blob): Promise<void> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({
      path: key,
      data: await blobToBase64(data),
      directory: Directory.Data,
      recursive: true,
    });
  }

  async readFile(key: string): Promise<Blob | null> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    try {
      const result = await Filesystem.readFile({ path: key, directory: Directory.Data });
      return typeof result.data === "string" ? base64ToBlob(result.data) : result.data;
    } catch {
      return null;
    }
  }

  async deleteFile(key: string): Promise<void> {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    try {
      await Filesystem.deleteFile({ path: key, directory: Directory.Data });
    } catch {
      // already absent
    }
  }
}

export function getAppFilesystem(): AppFilesystem {
  return isNativeRuntime() ? new NativeCapacitorFilesystem() : new WebOpfsFilesystem();
}
