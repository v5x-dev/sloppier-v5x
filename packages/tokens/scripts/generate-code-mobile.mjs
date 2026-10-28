import { readFile, writeFile } from "node:fs/promises";

const webUrl = new URL("../src/code/web.css", import.meta.url);
const mobileUrl = new URL("../src/code/mobile.css", import.meta.url);
const source = await readFile(webUrl, "utf8");

function tokens(selector) {
  const block = source.match(new RegExp(`${selector} \\{([^}]*)\\}`));
  if (!block) throw new Error(`Missing ${selector} token block`);
  return Object.fromEntries(
    [...block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value]),
  );
}

function colors(values) {
  return Object.entries(values)
    .filter(([name]) => !["radius", "shadow-raised", "shadow-overlay"].includes(name))
    .map(([name, value]) => `      --color-${name}: ${value};`)
    .join("\n");
}

const light = tokens(":root");
const dark = { ...light, ...tokens("\\.dark") };
if (!light.radius) throw new Error("Missing Code radius token");

const output = `/* Generated from Code's web tokens. Run bun run generate in packages/tokens. */
@theme {
  --radius-sm: calc(${light.radius} * 0.6);
  --radius-md: calc(${light.radius} * 0.8);
  --radius-lg: ${light.radius};
  --radius-xl: calc(${light.radius} * 1.4);
  --radius-2xl: calc(${light.radius} * 1.8);
  --radius-3xl: calc(${light.radius} * 2.2);
  --radius-4xl: calc(${light.radius} * 2.6);
}

@layer theme {
  :root {
    @variant light {
${colors(light)}
    }

    @variant dark {
${colors(dark)}
    }
  }
}
`;

if (process.argv.includes("--check")) {
  const current = await readFile(mobileUrl, "utf8").catch(() => "");
  if (current !== output) {
    throw new Error("Code mobile tokens are stale; run bun run generate in packages/tokens.");
  }
} else {
  await writeFile(mobileUrl, output);
}
