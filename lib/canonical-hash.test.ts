import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJsonStringify, computeContentHash } from "./canonical-hash.ts";

describe("canonical-hash", () => {
  describe("canonicalJsonStringify", () => {
    it("sorts top-level object keys regardless of insertion order", () => {
      assert.equal(canonicalJsonStringify({ b: 2, a: 1 }), canonicalJsonStringify({ a: 1, b: 2 }));
      assert.equal(canonicalJsonStringify({ a: 1, b: 2 }), '{"a":1,"b":2}');
    });

    it("sorts nested object keys at every depth", () => {
      const nested1 = { outer: { z: 1, a: { y: 2, x: 3 } } };
      const nested2 = { outer: { a: { x: 3, y: 2 }, z: 1 } };
      assert.equal(canonicalJsonStringify(nested1), canonicalJsonStringify(nested2));
    });

    it("never reorders array elements, even when object key order also differs", () => {
      assert.equal(canonicalJsonStringify({ a: [1, 2, 3] }), '{"a":[1,2,3]}');
      assert.notEqual(canonicalJsonStringify({ a: [1, 2, 3] }), canonicalJsonStringify({ a: [3, 2, 1] }));
    });

    it("sorts object keys inside array elements without touching element order", () => {
      const withUnsortedKeys = [{ b: 1, a: 2 }, { d: 3, c: 4 }];
      const withSortedKeys = [{ a: 2, b: 1 }, { c: 4, d: 3 }];
      assert.equal(canonicalJsonStringify(withUnsortedKeys), canonicalJsonStringify(withSortedKeys));
    });
  });

  describe("computeContentHash", () => {
    it("is stable despite object-key ordering", () => {
      const hashA = computeContentHash({ submissionId: "sub-1", coreJobInfo: { customer: "Shoppas", unitNumber: "FL-104" } });
      const hashB = computeContentHash({ coreJobInfo: { unitNumber: "FL-104", customer: "Shoppas" }, submissionId: "sub-1" });
      assert.equal(hashA, hashB);
    });

    it("changes when array element order changes", () => {
      const hashA = computeContentHash({ photoUploads: ["a.jpg", "b.jpg"] });
      const hashB = computeContentHash({ photoUploads: ["b.jpg", "a.jpg"] });
      assert.notEqual(hashA, hashB);
    });

    it("changes when the actual payload content changes", () => {
      const hashA = computeContentHash({ coreJobInfo: { equipmentSerial: "TOY-88421" } });
      const hashB = computeContentHash({ coreJobInfo: { equipmentSerial: "TOY-88422" } });
      assert.notEqual(hashA, hashB);
    });

    it("is deterministic across repeated calls with the identical value", () => {
      const value = { a: 1, b: [1, 2, { c: 3 }] };
      assert.equal(computeContentHash(value), computeContentHash(value));
    });

    it("preserves primitive value identity — a number and its string form hash differently", () => {
      assert.notEqual(computeContentHash({ a: 1 }), computeContentHash({ a: "1" }));
    });

    it("distinguishes null from a missing key and from false", () => {
      const withNull = computeContentHash({ a: null });
      const withoutKey = computeContentHash({});
      const withFalse = computeContentHash({ a: false });
      assert.notEqual(withNull, withoutKey);
      assert.notEqual(withNull, withFalse);
    });

    it("hashes the null submission payload deterministically (no payload row)", () => {
      assert.equal(computeContentHash(null), computeContentHash(null));
      assert.notEqual(computeContentHash(null), computeContentHash({}));
    });
  });
});
