import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRows, rotateWebToZ, rowPositions } from "../lib/lattice.mjs";

const HALF_INCH = 12.7;
const QUARTER_INCH_PAIR = 63.5;

test("a 0.5 in row on a 444.5 mm part holds 35 holes, half a pitch from each end", () => {
  const positions = rowPositions({ pitch: HALF_INCH, phase: 0 }, 444.5);
  assert.equal(positions.length, 35);
  assert.equal(positions[0], -215.9);
  assert.equal(positions.at(-1), 215.9);
});

test("a staggered row has one hole fewer and sits half a pitch off-centre", () => {
  const positions = rowPositions({ pitch: HALF_INCH, phase: 0.5 }, 444.5);
  assert.equal(positions.length, 34);
  assert.equal(positions[0], -209.55);
});

test("a 2.5 in row, staggered, has six holes at 31.75, 95.25 and 158.75 either side", () => {
  assert.deepEqual(rowPositions({ pitch: QUARTER_INCH_PAIR, phase: 0.5 }, 444.5), [
    -158.75, -95.25, -31.75, 31.75, 95.25, 158.75,
  ]);
});

test("compareRows matches expected holes to probed ones, and reports missing and extra holes", () => {
  const rows = [{ wall: "web", across: 0, pitch: QUARTER_INCH_PAIR, phase: 0.5 }];
  const probed = rowPositions(rows[0], 444.5).map((x) => ({ axis: 2, u: x + 100, v: 0.1 }));
  const centre = [100, 0, 0];
  const ok = compareRows(rows, 444.5, probed, centre);
  assert.equal(ok.matched, 6);
  assert.equal(ok.missing.length, 0);
  assert.equal(ok.extra.length, 0);

  const missing = compareRows(rows, 444.5, probed.slice(1), centre);
  assert.equal(missing.missing.length, 1);

  const extra = compareRows(rows, 444.5, [...probed, { axis: 2, u: 0, v: 9 }], centre);
  assert.equal(extra.extra.length, 1);
});

test("rotateWebToZ lets rows written for a +Z web match a file drawn with a +Y web", () => {
  const centre = [10, -5, 3];
  const rows = [
    { wall: "web", across: 6.35, pitch: 63.5, phase: 0.5 },
    { wall: "side", across: 2, pitch: 63.5, phase: 0.5 },
  ];
  // Length 127 gives holes at -31.75 and 31.75. Web across 6.35 is raw z = 3 - 6.35; side across 2 is raw y = -5 + 2.
  const probed = [-31.75, 31.75].flatMap((x) => [
    { axis: 1, u: 3 - 6.35, v: 10 + x },
    { axis: 2, u: 10 + x, v: -5 + 2 },
  ]);
  const frame = rotateWebToZ(probed, centre);
  const result = compareRows(rows, 127, frame.holes, frame.centre);
  assert.equal(result.matched, 4);
  assert.equal(result.missing.length, 0);
  assert.equal(result.extra.length, 0);
  assert.equal(compareRows(rows, 127, probed, centre).matched, 0);
});
