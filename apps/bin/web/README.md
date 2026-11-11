# bin web

TanStack Start app for bin, the suite's parts inventory. Workspaces are the
shared suite workspaces, so one sign-in and one workspace list work across the
products.

- `bun run dev` starts the dev server on port 3003.
- Sign-in uses WorkOS AuthKit, the same as Code. Set `VITE_CONVEX_URL` and
  `VITE_WORKOS_CLIENT_ID` in `.env.local` (see the Code app's values).
- Colors come from `@v5x/tokens/bin/web.css` (shadcn preset `b1YnRHDyy`). Fonts
  and shared UI come from `@v5x/ui`.

## Data

bin's backend lives in `packages/backend`: `convex/bin.ts` (inventory, stock,
loans) and `convex/binCatalog.ts` (the VEX catalog). The catalog is generated
from `packages/backend/data/bin/vex-v5rc-legal-parts.csv`:

- `node scripts/generate-bin-catalog.mjs` in `packages/backend` regenerates
  `convex/binCatalogData.ts`.
- `npx convex run binCatalog:seed` loads it into a deployment. Rows that are
  already there are skipped.

The eight VEX C-channels are one catalog row, C-Channel. Its options are
material (steel or aluminum), width (2, 3, or 5), and length (1 to 35), and each
combination is counted on its own. The VEX part numbers stay as alternate SKUs,
and `convex/lib/binCChannel.ts` maps the sizes the catalog sells to their 3D
models.

Workspaces that had the eight VEX C-channel parts need one more step after the
seed: `npx convex run binCatalog:consolidateCChannels`. It moves their stock,
loans, and history into the C-Channel part and deletes the old parts. Running it
again does nothing. Each part's own low-stock level is not carried over.

## Roles

- Admins add parts and locations, change stock, and return any loan.
- Members borrow parts and return their own loans.

## 3D models

The part pane shows a rotatable 3D model beside the part. The models are GLB
files in `public/models`, converted from the STEP files in
[TlorschCode/VEX-V5-Parts-Solidworks-Download](https://github.com/TlorschCode/VEX-V5-Parts-Solidworks-Download),
a copy of VEX's official CAD downloads. `public/models/manifest.json` maps each
catalog SKU to its model. A SKU with no exact model falls back to a related size
of the same part (marked `approximate`), and parts with neither show a "no
model" state.

The screws are the exception: that library names them by length (`0.50 Inch Screw`)
instead of by SKU, so `scripts/model-overrides.json` maps each catalog SKU to its
file. Locking screws and set screws share the plain screw's shape and are marked
`approximate`.

To rebuild them:

```sh
gh repo clone TlorschCode/VEX-V5-Parts-Solidworks-Download <dir> -- --depth 1
bun run models:build -- --src <dir>
```

The script skips STEP files over 40 MB (the V5 Controller), simplifies each model
to about 12,000 triangles, and skips files it already converted. Add `--force`
to redo them all. These models have not been checked for licensing.

## Icons

Each part in the list has a flat, unlit icon. `scripts/generate-icons.mjs` makes
one per model, from the same GLB files, and writes them to `public/models/icons`
as single-color SVGs. The icons are masks, so they take the text color and follow
the theme. Run `bun run icons:build` after the models change. It skips icons that
already exist, and `--force` redoes them all.

For each model the script keeps the view with the largest silhouette, so gears
show their face and screws show their length. It rasterizes that silhouette and
traces it with potrace.
