import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * iOS offline-auth latency fix — regression guard proving the actual
 * production source of app/providers/AuthUserContextProvider.tsx's network
 * subscriber re-resolves auth state on BOTH connectivity transitions
 * (offline->online AND online->offline), not just the former. No React
 * component test harness exists in this codebase (see
 * local-submission-photo-boundary.test.ts's own doc for why a source guard,
 * not a rendered-component test, is the right tool here) — this inspects
 * the real file directly.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = join(__dirname, "..", "..", "app", "providers", "AuthUserContextProvider.tsx");
const source = readFileSync(PROVIDER_PATH, "utf8");

function extractFunctionBody(src: string, signatureNeedle: string): string {
  const sigIdx = src.indexOf(signatureNeedle);
  assert.ok(sigIdx >= 0, `Could not find "${signatureNeedle}" in AuthUserContextProvider.tsx — has it been renamed/moved? Update this test's needle.`);
  const braceStart = src.indexOf("{", sigIdx);
  assert.ok(braceStart >= 0);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error("Unbalanced braces while extracting the mount effect's body — source may have changed shape");
}

describe("AuthUserContextProvider's network subscriber re-resolves on both connectivity transitions", () => {
  const body = extractFunctionBody(source, "networkStatus.subscribe(");

  it("extracted a real subscriber callback (sanity check the extraction itself)", () => {
    assert.ok(body.length > 20, "networkStatus.subscribe(...) body looks suspiciously short — extraction may have failed silently");
  });

  it("triggers refresh() when connectivity CHANGES in either direction, not only offline->online", () => {
    // The old, asymmetric bug: `if (online && !wasOnline) void refresh();`
    // — never fired on a live online->offline drop. Guard against
    // regressing back to that exact shape.
    assert.ok(!/if\s*\(\s*online\s*&&\s*!wasOnline\s*\)/.test(body), "must not regress to the old offline->online-only trigger");
    assert.match(body, /if\s*\(\s*online\s*!==\s*wasOnline\s*\)/, "must re-resolve on ANY change, not just regaining connectivity");
  });

  it("still calls refresh() (not some other function) from the subscriber", () => {
    assert.match(body, /void refresh\(\)/);
  });
});
