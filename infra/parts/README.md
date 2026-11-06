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
bun run --cwd infra/parts build -- --fresh                     # ignore the per-Part cache and rebuild everything
bun run --cwd infra/parts test    # unit tests: holes, probes, lattice, mesh, GLB, manifest
```

Each Part's output is cached in `.cache/parts/<id>.json`, keyed by the STEP file's bytes, the
manifest entry, and a hash of this pipeline's code (`build.mjs` and `lib/`). A rebuild with
nothing changed reuses the cached entry and its GLB, so a push that changes one Part rebuilds
that Part only. The build prints how many Parts came from the cache and the total time.

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
  `pins` (both ends of a detected pin, with `pinDiameterMm` selecting its measured size),
  `probe` (square openings on a 0.25 in lattice, for plates), `bores+probe` (both, for
  flat parts), or `axle` (a computed axle for wheels). `through` finds every through-opening
  along the three axes by ray probes on all bodies together, measures its edges on a fine
  scan, and puts one point at each face (round openings take the cylinder's diameter). Use it
  for gears, bearings, brackets, spacers and gussets. `ends` places two hand sockets at the
  ends of the longest axis (`endDiameterMm`), for a Part whose drive socket is blind. `none`
  is for a Part that does not attach to anything, with a `snapGap` reason.
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

## Categories, families, and what the Catalog holds

Every entry has a `category` (the parts panel's top-level group) and a `family` (its
group inside that category). The families are listed in `lib/manifest.mjs`, and the app's
validator (`apps/design/web/src/catalog/validate.ts`) must list the same ones.

| Category | Parts | Families |
| --- | --- | --- |
| Structure | 79 | C-channels, angles, plates, gussets, standoffs, screws, nuts, brackets |
| Motion | 157 | shafts (standard, high-strength, capped), collars, spacers, washers, bearings, retainers, lock bars, bumpers, couplers, inserts, gears, racks, sprockets, chains, tank tread, wheels |
| Electronics | 27 | motors, Brain, battery and clip, radio, controller, sensors, switches, 3-wire expander |
| Pneumatics | 15 | cylinders (25, 50, 75 mm), reservoir, fittings, valves, regulator, gauge, manifold |
| Field Elements | 18 | one family per season: Push Back so far. Override, High Stakes and Spin Up have no readable source yet |

Cut Parts (channels, angles, square shafts) are generated at any length in the app.
Their hole rows are measured from the STEP file with `node rows.mjs <id> --json` and
then checked by the build, so a row that does not match the file stops the build.

Each channel length has its own row spec, measured from its STEP file. Shared bore-pattern
rules are not implemented yet.

A model with no Snap Points records a `snapGap` in the catalog. The app's validator
requires that reason, so an empty list can never pass silently. 139 of 278 models
have one, because the bore detector (`lib/holes.mjs`) finds a cylinder only when a face
covers 170 degrees within a 1.5 to 12 mm diameter. Many STEP files use B-spline holes,
bores over 12 mm, or bores that do not open on the bounding box, so they give none. Some
openings need a hand-placed point recorded as `manual`; the measured motor mounts are
covered in Known gaps below.

Mass is null for electronics, and for field elements (material `other`, a mix of
materials with no single density).

Budgets are targets. 129 models are above their triangle budget, because the simplifier
stops at the error limit first. Gears, sprockets, chains and racks use a 0.2 mm error
limit, since 0.05 mm cannot reach their budgets. The 1/8 in setscrew uses 0.1 mm, because
at 0.25 mm its threads collapse into a coil.

## Known gaps

- **Chassis rails** (275-1145, 275-1146): the 12.7 x 24.13 mm profile is not a channel or
  an angle, and the Cut Part generator draws only those and square shafts.
- **Flat bar** (275-1141, 1 x 25 in): no Cut Part family for it.
- **Linear Motion Kit rails and slides**: no V5 STEP in the sources checked. The SolidWorks
  repo has only `.SLDPRT` (binary) for its slide truck, and the SHU repo has IQ parts only.
  VEX's product page for the kit (276-6465) lists STEP files; not fetched in this PR.
- **Pneumatic tubing and solenoids**: no STEP in the Pneumatics folders checked.
- **High Stakes** field elements: the Fusion (`.f3d`) and Inventor (`.ipt`) files are
  ShapeManager B-reps (`.smb`), with no mesh. They need a kernel to read, so they are out.
- **Override** field elements: the Fusion files are binary B-reps as above. SHU-ROBOTICS
  has only the pin and cup as STL meshes. STL is not read by this pipeline yet.
- **Spin Up** field elements: no STEP found. The SJTU VEX open-source library (SolidWorks)
  and a third-party disc on stlfinder were found, but not checked.
- **Field goals** are split into their STEP files (the centre goal's bottom, top and leg
  are three Parts), not merged into one Part per goal. Merging needs multi-file sources.
- **Snap Points** remain incomplete on 139 models (see above). The motors' mounting holes
  are measured positions (`extraSnaps`), not detected bores. The 11 W motor's four 8-32
  holes sit at the corners of each end face, at (±21.95, ±14) mm in the STEP frame. The
  5.5 W motor's two 8-32 holes are on its end face at x = 0, 12.7 mm apart. Tests pin the
  11 W positions.
- **Wheel bores** are not read reliably; wheels get a computed axle at their centre.
- **Steel plates** keep 3,080 and 5,120 triangles against their 6,000 target. Each hole
  needs four walls (8 triangles), so the remaining faces cannot be removed without losing
  holes.
- **Cut-part fit** is based on the measured catalog rows. Shared bore-pattern rules are not
  implemented, and the steel angle is not included as a Cut Part.
- **Recents** in the parts panel are not built.
- **Mass** uses STEP volume times handbook density, not a measured weight. Electronics
  have no density, so motor mass stays null until a published figure is recorded.
- **Model overlaps** at channel webs/sides and angle legs are kept as separate plates; the
  overlapping faces are hidden inside the Part.

## Sources, licences, and credit

Each source was checked for a licence file at its pinned commit. The licence says what the
pipeline may do with the files it reads, and what the app may ship.

| Source | Licence | Used for |
| --- | --- | --- |
| `vex-cad-download` (TlorschCode/VEX-V5-Parts-Solidworks-Download, pinned in `lib/sources.mjs`) | None in the repo. The README says the parts are unchanged from VEX's CAD downloads, and its field elements from VEX's Onshape document. VEX's terms apply; not verified. | Every fixed model, Cut Part, and Push Back field element |
| `solidpython4vex` (UTCSheffield/SolidPython4VEX) | MIT (`LICENSE`, Copyright 2026 UTC Sheffield) | SKU names for Parts whose file name has none |
| VEX-CAD-Fusion-360-Library, VEX-CAD-Inventor, VEX-CAD-Solidworks, SHU-ROBOTICS/VEX-CAD-FILES | No licence file found at the default branch | Searched, not used. Their Override and High Stakes files are unreadable (see Known gaps) |

- `vex-cad-download`: TlorschCode/VEX-V5-Parts-Solidworks-Download, pinned in
  `lib/sources.mjs`. The repo describes its files as unchanged from VEX's CAD downloads.
- `solidpython4vex`: UTCSheffield/SolidPython4VEX (MIT), `catalog.json`, for SKU metadata.
  Used to name the screws' SKUs, which are not in their file names. Those SKUs are
  inferred by name and shank size, and the catalog records that.

The SHU-ROBOTICS/VEX-CAD-FILES repo was not needed in this PR, since every part in the
first set is in the primary source.
