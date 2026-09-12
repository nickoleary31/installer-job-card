import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { digitsOnly, formatPhoneNumber } from "./phone.ts";

describe("digitsOnly", () => {
  it("strips every non-digit character", () => {
    assert.equal(digitsOnly("(678) 780-9723"), "6787809723");
    assert.equal(digitsOnly("+1 678.780.9723"), "16787809723");
    assert.equal(digitsOnly("abc123def456"), "123456");
  });

  it("returns an empty string when there are no digits", () => {
    assert.equal(digitsOnly(""), "");
    assert.equal(digitsOnly("Call front desk"), "");
  });
});

describe("formatPhoneNumber", () => {
  it("builds up the live-typing mask as digits accumulate", () => {
    assert.equal(formatPhoneNumber(""), "");
    assert.equal(formatPhoneNumber("6"), "(6");
    assert.equal(formatPhoneNumber("678"), "(678");
    assert.equal(formatPhoneNumber("6787"), "(678) 7");
    assert.equal(formatPhoneNumber("678780"), "(678) 780");
    assert.equal(formatPhoneNumber("6787809"), "(678) 780-9");
    assert.equal(formatPhoneNumber("6787809723"), "(678) 780-9723");
  });

  it("normalizes an already-punctuated complete 10-digit number to the canonical form", () => {
    assert.equal(formatPhoneNumber("678-780-9723"), "(678) 780-9723");
    assert.equal(formatPhoneNumber("678.780.9723"), "(678) 780-9723");
    assert.equal(formatPhoneNumber("(678) 780-9723"), "(678) 780-9723");
  });

  it("is idempotent — formatting an already-formatted value returns the same value", () => {
    const once = formatPhoneNumber("6787809723");
    assert.equal(formatPhoneNumber(once), once);
  });

  it("caps at 10 digits, silently dropping anything typed/pasted beyond that (existing V1 masked-input behavior)", () => {
    assert.equal(formatPhoneNumber("678780972399"), "(678) 780-9723");
  });

  it("ignores non-digit characters entirely rather than treating them as separators to preserve", () => {
    assert.equal(formatPhoneNumber("abc678def780ghi9723"), "(678) 780-9723");
  });
});
