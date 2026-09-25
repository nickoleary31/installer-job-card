import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NATIVE_RESUME_EVENT, subscribeToNativeResume } from "./app-lifecycle.ts";

describe("subscribeToNativeResume — Checkpoint 1's app-resume sync trigger", () => {
  it("calls back on Capacitor's document 'resume' event, and stops after unsubscribe", () => {
    const target = new EventTarget();
    let resumes = 0;
    const unsubscribe = subscribeToNativeResume(target, () => {
      resumes += 1;
    });

    target.dispatchEvent(new Event(NATIVE_RESUME_EVENT));
    target.dispatchEvent(new Event(NATIVE_RESUME_EVENT));
    assert.equal(resumes, 2);

    unsubscribe();
    target.dispatchEvent(new Event(NATIVE_RESUME_EVENT));
    assert.equal(resumes, 2);
  });

  it("ignores the paired 'pause' event and unrelated events", () => {
    const target = new EventTarget();
    let resumes = 0;
    subscribeToNativeResume(target, () => {
      resumes += 1;
    });
    target.dispatchEvent(new Event("pause"));
    target.dispatchEvent(new Event("visibilitychange"));
    assert.equal(resumes, 0);
  });
});
