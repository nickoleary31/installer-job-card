import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAppleMapsUrl, buildGoogleMapsUrl, buildWazeUrl, toSingleLineAddress } from "./address.ts";

describe("toSingleLineAddress", () => {
  it("joins a two-line street/city-state-zip address with a comma", () => {
    assert.equal(toSingleLineAddress("5811 Priest Rd\nAcworth, GA 30102"), "5811 Priest Rd, Acworth, GA 30102");
  });

  it("joins a three-line address (street, street 2, city/state/zip)", () => {
    assert.equal(
      toSingleLineAddress("123 Main St\nSuite 200\nAcworth, GA 30102"),
      "123 Main St, Suite 200, Acworth, GA 30102",
    );
  });

  it("trims each line and drops blank lines rather than emitting empty segments", () => {
    assert.equal(toSingleLineAddress("  123 Main St  \n\n  Acworth, GA 30102  "), "123 Main St, Acworth, GA 30102");
  });

  it("returns an already-single-line address unchanged", () => {
    assert.equal(toSingleLineAddress("123 Main St, Acworth, GA 30102"), "123 Main St, Acworth, GA 30102");
  });

  it("returns an empty string for blank input", () => {
    assert.equal(toSingleLineAddress(""), "");
    assert.equal(toSingleLineAddress("   \n  "), "");
  });
});

describe("buildGoogleMapsUrl", () => {
  it("URL-encodes the address into a Google Maps search query", () => {
    assert.equal(
      buildGoogleMapsUrl("5811 Priest Rd, Acworth, GA 30102"),
      "https://www.google.com/maps/search/?api=1&query=5811%20Priest%20Rd%2C%20Acworth%2C%20GA%2030102",
    );
  });
});

describe("buildAppleMapsUrl", () => {
  it("URL-encodes the address into an Apple Maps query", () => {
    assert.equal(
      buildAppleMapsUrl("5811 Priest Rd, Acworth, GA 30102"),
      "https://maps.apple.com/?q=5811%20Priest%20Rd%2C%20Acworth%2C%20GA%2030102",
    );
  });
});

describe("buildWazeUrl", () => {
  it("URL-encodes the address into a Waze universal navigate link", () => {
    assert.equal(
      buildWazeUrl("5811 Priest Rd, Acworth, GA 30102"),
      "https://waze.com/ul?q=5811%20Priest%20Rd%2C%20Acworth%2C%20GA%2030102&navigate=yes",
    );
  });
});
