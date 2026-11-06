#!/usr/bin/env node
// Uploads the GLB files the catalog references to the models bucket on Cloudflare R2.
//
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... R2_BUCKET=... node upload.mjs
//   node upload.mjs --dry-run      # list what would be sent, send nothing
//
// The token needs R2 object write access to the bucket. Names are content hashes, so
// every object is sent with an immutable cache header. Credentials come only from the
// environment; this script never prints them.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(here, "../../apps/design/web/src/catalog/catalog.json");
const modelsDir = join(here, ".cache");
const dryRun = process.argv.includes("--dry-run");

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const files = catalog.parts.filter((p) => p.kind === "model").map((p) => p.model.file);

if (dryRun) {
  for (const file of files) console.log(file);
  console.log(`${files.length} objects (dry run, nothing sent)`);
  process.exit(0);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const bucket = process.env.R2_BUCKET;
for (const [name, value] of Object.entries({ CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token, R2_BUCKET: bucket })) {
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
}

let sent = 0;
for (const file of files) {
  const body = readFileSync(join(modelsDir, file));
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(file)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "model/gltf-binary",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`PUT ${file} failed: HTTP ${response.status} ${text.slice(0, 500)}`);
    process.exit(1);
  }
  sent += 1;
  console.log(`uploaded ${file} (${body.length} bytes)`);
}
console.log(`${sent} objects uploaded to ${bucket}`);
