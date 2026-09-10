const DEFAULT_SIZE_CLASSNAME = "h-12 w-auto sm:h-16";

export type TkpLogoProps = {
  /** Overrides the default responsive size (h-12 w-auto sm:h-16, ~48px mobile / 64px desktop). */
  className?: string;
  /** Preload hint for a header logo that sits above the fold on first paint. */
  priority?: boolean;
};

/**
 * Theme-aware TKP Telematics application-brand logo (the installer/company brand shown above
 * "Installer Sheetz" in every technician-facing header).
 *
 * This app's dark theme is driven entirely by the OS/browser `prefers-color-scheme` media query
 * (see the `@media (prefers-color-scheme: dark)` block in app/globals.css) — there is no
 * user-selectable/persisted theme state anywhere in the app. This uses the native
 * `<picture>`/`<source media>` mechanism to target that same real mechanism directly: the
 * browser requests only the PNG that actually matches the current theme, never both. Verified
 * empirically (not just per spec): on an initial light-theme load only tkp-telematics-logo.png
 * is requested; toggling the OS/browser color scheme live re-evaluates the `<source>` and swaps
 * to tkp-telematics-logo-dark.png with no reload — the dark asset is fetched only at that point,
 * on demand, never pre-fetched alongside the light one on a normal (non-switching) session.
 *
 * The `<img>` fallback is the only element `<picture>` exposes to the accessibility tree — the
 * `<source>` carries no accessible content of its own — so there is exactly one accessible image
 * here at all times, with no duplicate-name concern to manage.
 *
 * No CSS filters, invert(), or recoloring — each PNG is the real supplied artwork for its theme.
 */
export function TkpLogo({ className = DEFAULT_SIZE_CLASSNAME, priority = false }: TkpLogoProps) {
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet="/tkp-telematics-logo-dark.png" />
      <img
        src="/tkp-telematics-logo.png"
        alt="TKP Telematics"
        fetchPriority={priority ? "high" : undefined}
        className={className}
      />
    </picture>
  );
}
