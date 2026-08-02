/**
 * Non-production install-guide model for device profiles / variants.
 * Production will use signed/internal URLs — never raw private bucket paths.
 */

export type GuideDocumentType = "pdf" | "html" | "external_page";

export type GuideSourceKind = "cached" | "manufacturer";

export type InstallGuideDefinition = {
  title: string;
  /** Manufacturer / help-center URL (public). */
  sourceUrl: string | null;
  /**
   * Internal app path or API route that serves the cached copy
   * (e.g. `/api/guides/linxup/at3` → signed storage URL).
   * Prototype may use a public `/guides/...` placeholder.
   */
  cachedUrl: string | null;
  documentType: GuideDocumentType;
  version: string | null;
  revision: string | null;
  lastVerifiedAt: string | null;
  preferredSource: GuideSourceKind;
  fallbackSource: GuideSourceKind;
  /** When true, hide View Installation Guide (outdated / disabled). */
  disabled?: boolean;
  disabledReason?: string;
};

export type ResolvedInstallGuide = {
  definition: InstallGuideDefinition;
  /** URL chosen for open, or null if unavailable. */
  openUrl: string | null;
  usedSource: GuideSourceKind | null;
  sourceLabel: "cached copy" | "manufacturer site" | null;
  available: boolean;
  unavailableMessage: string | null;
};

/** Resolve open URL without blocking the install form. */
export function resolveInstallGuide(guide: InstallGuideDefinition | null | undefined): ResolvedInstallGuide {
  if (!guide) {
    return {
      definition: {
        title: "Installation Guide",
        sourceUrl: null,
        cachedUrl: null,
        documentType: "pdf",
        version: null,
        revision: null,
        lastVerifiedAt: null,
        preferredSource: "cached",
        fallbackSource: "manufacturer",
      },
      openUrl: null,
      usedSource: null,
      sourceLabel: null,
      available: false,
      unavailableMessage: "No installation guide is configured for this device.",
    };
  }

  if (guide.disabled) {
    return {
      definition: guide,
      openUrl: null,
      usedSource: null,
      sourceLabel: null,
      available: false,
      unavailableMessage: guide.disabledReason || "Installation guide is disabled (outdated).",
    };
  }

  const cached = (guide.cachedUrl || "").trim() || null;
  const manufacturer = (guide.sourceUrl || "").trim() || null;

  const tryOrder: GuideSourceKind[] =
    guide.preferredSource === "manufacturer"
      ? ["manufacturer", "cached"]
      : ["cached", "manufacturer"];

  // Prefer preferred, then fallback, then the other if present
  const ordered = [...new Set([guide.preferredSource, guide.fallbackSource, ...tryOrder])];

  for (const kind of ordered) {
    const url = kind === "cached" ? cached : manufacturer;
    if (!url) continue;
    return {
      definition: guide,
      openUrl: url,
      usedSource: kind,
      sourceLabel: kind === "cached" ? "cached copy" : "manufacturer site",
      available: true,
      unavailableMessage: null,
    };
  }

  return {
    definition: guide,
    openUrl: null,
    usedSource: null,
    sourceLabel: null,
    available: false,
    unavailableMessage: "Installation guide URL is missing. You can continue the install without it.",
  };
}

/**
 * Lightweight HEAD/GET probe for prototype / future admin tools.
 * Never blocks form open — call asynchronously after paint.
 */
export async function probeGuideUrl(url: string, timeoutMs = 4000): Promise<"ok" | "missing" | "error"> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    if (res.ok) return "ok";
    if (res.status === 404 || res.status === 410) return "missing";
    // Some CDNs reject HEAD — try GET range-less as soft check
    if (res.status === 405 || res.status === 403) {
      const getRes = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
      if (getRes.ok) return "ok";
      if (getRes.status === 404 || getRes.status === 410) return "missing";
      return "error";
    }
    return "error";
  } catch {
    return "error";
  }
}
