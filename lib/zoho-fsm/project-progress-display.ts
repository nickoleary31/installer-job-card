/**
 * Formats the "Completed submissions" count on an admin Project card, incorporating the Zoho SA
 * Target Asset Count evidence (lib/zoho-fsm/project-progress.ts) when a project is Zoho-linked
 * and that evidence has been captured. Display-only — never mutates or recomputes stored data;
 * the original sa_target_asset_count stays untouched in the database no matter what is shown
 * here.
 *
 * Denominator selection (V1 card):
 *   - sa_target_asset_count is used whenever it is NOT NULL, e.g. "2 / 4".
 *   - otherwise (a non-Zoho-linked project, or a Zoho-linked one with no Target captured yet —
 *     both real, reachable states, since sa_target_asset_count is a nullable column with no
 *     guarantee it's ever been set) the existing plain-count display is preserved, e.g. "7".
 *
 * saFinalizedAssetCount is intentionally accepted but NOT used to select the denominator here.
 * An earlier version of this function used Finalized in place of Target whenever Finalized was
 * non-null — that was a requirements miscommunication: Finalized being populated does not by
 * itself mean a batch has been intentionally finalized (e.g. a SA can carry both a live Target
 * and a leftover/unrelated Finalized value simultaneously), so it must never silently override
 * Target here. A future explicit "N / N Complete" finalized-state display is intentionally NOT
 * built in this function — that belongs to the future orchestrator, which will own real batch
 * finalization, not to an inference from Finalized's mere presence.
 *
 * Explicit null check on Target: 0 is a real, meaningful target value and must never be treated
 * as falsy/missing via truthiness checks.
 */
export function formatCompletedSubmissionCount(args: {
  completedSubmissionCount: number;
  saTargetAssetCount: number | null;
  saFinalizedAssetCount: number | null;
}): string {
  return args.saTargetAssetCount !== null
    ? `${args.completedSubmissionCount} / ${args.saTargetAssetCount}`
    : `${args.completedSubmissionCount}`;
}
