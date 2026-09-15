import { isNativeRuntime } from "./runtime";

/**
 * Boundary interface only (Phase 1A). Generic blob storage by key — deliberately
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

/** Phase 1B/2: back this with @capacitor/filesystem for app-private native storage. */
class NativeFilesystemNotImplemented implements AppFilesystem {
  writeFile(): Promise<void> {
    throw new Error("Native filesystem is not implemented yet. Install and wire @capacitor/filesystem in a later phase.");
  }
  readFile(): Promise<Blob | null> {
    throw new Error("Native filesystem is not implemented yet. Install and wire @capacitor/filesystem in a later phase.");
  }
  deleteFile(): Promise<void> {
    throw new Error("Native filesystem is not implemented yet. Install and wire @capacitor/filesystem in a later phase.");
  }
}

export function getAppFilesystem(): AppFilesystem {
  return isNativeRuntime() ? new NativeFilesystemNotImplemented() : new WebOpfsFilesystem();
}
