import assert from "node:assert/strict";
import { test } from "node:test";
import { skuFromFileName } from "../lib/sku.mjs";

test("reads the SKU from the file name", () => {
  assert.equal(skuFromFileName("Motors/V5 Smart Motor (276-4840).step"), "276-4840");
  assert.equal(
    skuFromFileName("C Channels/Aluminum/1x2x1x35 Aluminum C-Channel (276-2289).step"),
    "276-2289"
  );
});

test("reads three-part SKUs and SKUs with a suffix", () => {
  assert.equal(skuFromFileName("Gussets/30 Degree Flat Gusset (276-7758-001).step"), "276-7758-001");
  assert.equal(skuFromFileName("Shafts (axles)/Capped/1 Capped Shaft (228-2500-2219).step"), "228-2500-2219");
});

test("accepts a space before the extension", () => {
  assert.equal(skuFromFileName("Wheels/Mecanum/2” Mecanum Wheels V2 (Left) (276-9041-801) .step"), "276-9041-801");
});

test("returns null when a file has no SKU", () => {
  assert.equal(skuFromFileName("Screws and Nuts/Screws/0.125 Inch Setscrew.step"), null);
});

test("does not mistake a dimension for a SKU", () => {
  assert.equal(skuFromFileName("Plates/5x15 Steel Plate.step"), null);
});
