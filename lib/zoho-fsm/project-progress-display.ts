/**
 * Formats the "Completed submissions" count on an admin Project card, incorporating the Zoho SA
 * Target/Finalized Asset Count evidence (lib/zoho-fsm/project-progress.ts) when a project is
 * Zoho-linked and that evidence has been captured. Display-only — never mutates or recomputes
 * stored data; the original sa_target_asset_count stays untouched in the database no matter what
 * is shown here.
 *
 * Denominator selection:
 *   - sa_finalized_asset_count is used when NOT NULL (a finalized batch shows
 *     completed/finalized, e.g. "17 / 17").
 *   - otherwise sa_target_asset_count is used when NOT NULL (an active/not-yet-finalized batch
 *     shows completed/target, e.g. "17 / 100" — the original 100 stays visible and stored even
 *     after finalization changes the denominator).
 *   - otherwise (neither present — a non-Zoho-linked project, or no evidence captured yet) the
 *     existing plain-count display is preserved, e.g. "7".
 *
 * Explicit null checks throughout: 0 is a real, meaningful finalized value ("finalized with zero
 * completed assets") and must never be treated as falsy/missing via truthiness checks.
 */
export function formatCompletedSubmissionCount(args: {
  completedSubmissionCount: number;
  saTargetAssetCount: number | null;
  saFinalizedAssetCount: number | null;
}): string {
  const denominator =
    args.saFinalizedAssetCount !== null
      ? args.saFinalizedAssetCount
      : args.saTargetAssetCount !== null
        ? args.saTargetAssetCount
        : null;
  return denominator !== null
    ? `${args.completedSubmissionCount} / ${denominator}`
    : `${args.completedSubmissionCount}`;
}
