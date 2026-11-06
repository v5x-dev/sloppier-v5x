# Part pipeline

Turns VEX's STEP CAD files into the Part models and the catalog that the Design app
uses. It runs at dev time only. Git keeps the pipeline and `catalog.json`. The converted
models (compressed GLB) go to Cloudflare R2, never to git. `occt-import-js` is LGPL and
is used here at build time only; it never ships to users.

The rule from [ADR 0001](../../docs/adr/0001-design-is-built-independently-of-protobot.md)
applies: nothing here reads or copies Protobot-Rebuilt. The only sources are the public
repositories pinned in `lib/sources.mjs`.

## Running it

```sh
bun install                       # from the repo root; this folder is a workspace
bun run --cwd infra/parts build   # every part in manifest.json, ~80 seconds
bun run --cwd infra/parts build -- --only motor-v5-smart-11w   # one part; does not rewrite catalog.json
bun run --cwd infra/parts test    # unit tests: holes, probes, lattice, mesh, GLB, manifest
```

`build` does four things for each part:

1. **Reads the STEP file** from the pinned commit with `git show`, from a blobless clone
   kept in `.cache/sources/`. It checks the declared length unit and the bounding box
   against `expectSizeMm` in the manifest. A file in inches that is read as millimetres
   fails here.
2. **Measures it** with occt: triangle count at the tessellation the raw budgets were
   measured with (linear 0.2 mm, angular 0.5 rad), solid volume, bores and pins from
   cylindrical faces (`lib/holes.mjs`), and hole openings found by ray probes
   (`lib/probe.mjs`, `lib/lattice.mjs`).
3. **Builds a model** (fixed Parts): snap points by the manifest's strategy, mass from
   volume and density, then the display mesh (`lib/display.mjs`), written as a
   meshopt-compressed GLB with normals and per-region colours into `.cache/models/`.
   The file name carries the first eight hex digits of its hash.

The display mesh is the shape a viewer sees, not the solid. Its steps:

- **Visible surfaces only** (`lib/exterior.mjs`). The bounding box is voxelised and
  flood-filled from outside, with a one-voxel seal so seams do not leak. Triangles that
  touch no outside air are dropped. Gears and boards sealed inside a case go, and so do
  faces hidden in a socket's depth only if no opening reaches them.
- **Colours per region.** Each colour from the STEP solids is simplified on its own, so
  colour boundaries are open edges and stay sharp. Colours go in as vertex colours.
- **Feature edges are locked** (`lockedVertices`). Edges that turn more than 35 degrees,
  open edges, and colour boundaries keep their vertices, so the simplifier cannot round
  off a real edge. Everything else is reduced toward the budget under `maxErrorMm`.
- **Normals respect the crease** (`lib/normals.mjs`). Each corner averages only the faces
  within 35 degrees of its own, so curves shade smooth and edges stay hard.

Solids of revolution take a different path (`lib/lathe.mjs`). A screw is a dome head and a
shank, so its display mesh is the measured radius profile along its axis, simplified within
`maxErrorMm` and revolved around the axis with `segments` sides (12). That gives about 300
triangles where the visible-surface path, with its locked sharp edges, cannot get below 380.
The manifest marks these entries with `"remodel": "lathe"`. Checked by hand on the 1-inch
screw: the revolved volume is 407.8 mm³ against the STEP's 409.4 mm³. The build does not
check this; `tests/lathe.test.mjs` covers the parts of the method on fixtures.

Snap Points, volume and mass still come from the full STEP, before any of this runs.
`bun run --cwd infra/parts review -- --only <id>` writes the full tessellation and the
display mesh side by side under `.cache/review/`, rendered with Blender, for comparing by eye.
4. **Verifies a spec** (Cut Parts): the probed holes must match the `rows` in the manifest
   exactly, with no missing and no extra holes, or the build stops.

`catalog.json` is written to `apps/design/web/src/catalog/`. The app validates it when it
loads (`checkCatalog`), and its tests check it again.

## Adding a part

Adding a Part is a manifest entry. For a fixed model:

```json
{
  "id": "gusset-60-flat",
  "name": "60 Degree Flat Gusset",
  "family": "gusset",
  "kind": "model",
  "source": { "repo": "vex-cad-download", "path": "Gussets/60 Degree Flat Gusset (276-7760-001).step" },
  "material": "steel",
  "snap": "bores+probe",
  "budgetTriangles": 600,
  "maxErrorMm": 0.05
}
```

- `source.path` is the path inside the repo. The SKU comes from the file name. If the file
  has no SKU, give one in `"sku": { "value": "...", "source": "solidpython4vex-name", "note": "..." }`.
- `snap` picks the Snap Point strategy: `bores` (detected bore openings), `ruled-bores`
  (bores matched by a rule, for hand corrections), `shank` (a fastener's shank ends),
  `probe` (square openings on a 0.25 in lattice, for plates), `bores+probe` (both, for
  flat parts), or `axle` (a computed axle for wheels).
- `budgetTriangles` and `maxErrorMm` are the simplifier's target and error limit. The
  build reports what it achieved; a miss means the error limit was reached first.
- `expectSizeMm` (optional) checks the bounding box against known sizes.

For a Cut Part (a channel or angle at any length, or a square shaft), run
`node rows.mjs <id>` after adding the entry with `"cut": {...}` and `"rows": []`. It prints
the holes it finds, grouped by wall, to copy into the spec. Then run `build`, which checks
the spec against the STEP file. The row fields are: `wall` (`web` for a plate normal to
Z, `side` for one normal to Y), `across` (the hole's position across the wall, centred),
`pitch` (12.7 for 0.5 in, 63.5 for 2.5 in), and `phase` (0, or 0.5 for a staggered row). If the file is drawn with its web normal to +Y, set
`source.webNormal` to `"y"` and write the rows as if the web were normal to +Z: `rows.mjs` prints
raw axes, so swap its two walls, and negate `across` on the web.

## Coordinates

Every catalog number is in millimetres. Positions and directions are in the Part frame:
Y up, origin at the centre of the Part's bounding box. The pipeline reads STEP's Z-up
frame and rotates it about X by -90 degrees, `(x, y, z) -> (x, z, -y)`, which is a proper
rotation. Cut Parts use the same frame, with the length along X. The GLB files use the
same numbers. glTF defines metres, so the app must not rescale them.

## Budgets and what they cost

Budgets follow how often a Part appears in a robot. A rare Part can afford far more: the
11W motor appears a dozen times, so it gets a budget in the tens of thousands. A screw
appears hundreds of times and stays in the hundreds. Each budget is `budgetTriangles` in
`manifest.json`, with `maxErrorMm` as the limit on surface error.

The budget is a target, and a Part can miss it. Feature edges are locked, and an edge
whose two ends are locked cannot collapse, so a Part with many sharp edges (the wheel's
rollers) keeps a floor above its budget. The build prints the achieved count against the
raw one, and nothing is hidden: a missed budget shows in the table.

## Known gaps

- Snap Points are not complete for every part. The V5 motor's mounting bores do not open
  onto the bounding box, so the motor has a hand-corrected rule (`ruled-bores`). The
  5.5 W motor has no snap points: its STEP file has no bore that opens on the outside, so
  it needs a corrected file or measured positions.
- The steel angle is not included as a Cut Part.
- The steel plates miss their 1,200 triangle budget and keep 3,080 and 5,120. Each hole needs
  four walls (8 triangles), and nothing collapses within 0.5 mm, so reaching the budget would
  mean removing holes. The manifest notes give the numbers.
- Wheels get a computed axle at their centre. The STEP hub bore could not be detected
  reliably, so the bore is not read.
- Mass uses the STEP volume times a handbook density, not a measured weight. Electronics
  have no density, so motor mass stays null until a published figure is recorded.
- The model's corner overlaps (the channel's web and sides, and the angle's legs) are
  kept as separate plates, so the mesh is slightly larger than the solid it describes.
  The overlapping faces are hidden inside the Part.

## Sources and credit

- `vex-cad-download`: TlorschCode/VEX-V5-Parts-Solidworks-Download, pinned in
  `lib/sources.mjs`. The repo describes its files as unchanged from VEX's CAD downloads.
- `solidpython4vex`: UTCSheffield/SolidPython4VEX (MIT), `catalog.json`, for SKU metadata.
  Used to name the screws' SKUs, which are not in their file names. Those SKUs are
  inferred by name and shank size, and the catalog records that.

The SHU-ROBOTICS/VEX-CAD-FILES repo was not needed in this PR, since every part in the
first set is in the primary source.
