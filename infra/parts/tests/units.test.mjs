import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkExpectedSize,
  declaredLengthUnit,
  toMillimetres,
} from "../lib/units.mjs";

const inchFile = `DATA;
#1 = LENGTH_UNIT ( ) NAMED_UNIT ( * ) SI_UNIT ( $, .METRE. ) ;
#2 = CONVERSION_BASED_UNIT ( 'INCH', #3 ) LENGTH_UNIT ( ) NAMED_UNIT ( #4 ) ;
#9 = ( GEOMETRIC_REPRESENTATION_CONTEXT ( 3 ) GLOBAL_UNIT_ASSIGNED_CONTEXT ( ( #2, #5, #6 ) ) REPRESENTATION_CONTEXT ( 'NONE', 'WORKASPACE' ) );
ENDSEC;`;

const mmFile = `DATA;
#1 = ( LENGTH_UNIT ( ) NAMED_UNIT ( * ) SI_UNIT ( .MILLI., .METRE. ) );
#9 = ( GEOMETRIC_REPRESENTATION_CONTEXT ( 3 ) GLOBAL_UNIT_ASSIGNED_CONTEXT ( ( #1 ) ) );
ENDSEC;`;

test("reads the declared length unit from the geometric context", () => {
  assert.equal(declaredLengthUnit(inchFile), "inch");
  assert.equal(declaredLengthUnit(mmFile), "mm");
});

test("reports unknown when the file declares no unit", () => {
  assert.equal(declaredLengthUnit("DATA;\nENDSEC;"), "unknown");
});

test("converts lengths to millimetres", () => {
  assert.equal(toMillimetres(0.04, "inch"), 1.016);
  assert.equal(toMillimetres(17.5, "inch"), 444.5);
  assert.equal(toMillimetres(4.2, "mm"), 4.2);
  assert.throws(() => toMillimetres(1, "furlong"), /Unknown length unit/);
});

test("accepts a measured size that matches the expected size", () => {
  checkExpectedSize("C-channel", { x: 444.5, y: 25.4, z: 13.97 }, { x: 444.5 });
});

test("rejects a size that is 25.4 times off, the symptom of a wrong unit", () => {
  assert.throws(
    () => checkExpectedSize("C-channel", { x: 17.5, y: 1, z: 0.55 }, { x: 444.5 }),
    /expected 444.5 mm/
  );
});
