/**
 * Task 14.6b — compute parity harness, part 2: migration-map runMapping.
 *
 * Imports the REAL TypeScript lib (src/lib/migration-mapper.ts — pure, no
 * network) and runs buildMigrationMap + renderRedirectMap on the same URL
 * lists the ported Rust endpoint receives. The WHATWG `new URL` shaping is
 * done here exactly like the Next proxy does it (shapeUrl), then diffed
 * byte-for-byte against /api/internal/tools/migration-map/run.
 *
 * Usage: bun backend/tools/parity-14.6b-migration.ts   (backend on :3100)
 */
import { execSync } from "node:child_process";
import {
  buildMigrationMap,
  renderRedirectMap,
} from "../../src/lib/migration-mapper";

const ROOT = execSync("git rev-parse --show-toplevel").toString().trim();
const TOKEN = execSync(
  `cat "${ROOT}/data/.seo-internal-token" 2>/dev/null || cat "${ROOT}/.seo-internal-token"`,
).toString().trim();

// splitList + shapeUrl — verbatim from the Next proxy in
// src/app/tools/migration-map/actions.ts (the runMapping half).
function splitList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 1000);
}

type ShapedUrl = { url: string; pathname: string; search: string; ok: boolean };

function shapeUrl(raw: string): ShapedUrl {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://x${raw}`);
    return { url: raw, pathname: u.pathname, search: u.search, ok: true };
  } catch {
    return { url: raw, pathname: "", search: "", ok: false };
  }
}

const FIXTURES: { name: string; oldUrls: string; newUrls: string }[] = [
  {
    name: "M1 golden path (exact / strong / no-match mix)",
    oldUrls: [
      "/old-blog/my-post.html",
      "/blog/my-post",
      "/contact",
      "/legacy-page",
      "/products/red-shoes",
    ].join("\n"),
    newUrls: [
      "/blog/my-post",
      "/contact-us",
      "/products/red-shoes-sneakers",
      "/about",
    ].join("\n"),
  },
  {
    name: "M2 edges (unparseable, dupes, query strings, extensions, IPv4-ish host, separators)",
    oldUrls: [
      "/blog/old-post.php?q=1",
      "/about/",
      "/shop/red,shoes.html",
      "https://OTHER.example.com/Deep/Path",
      "not a url!!!",
      "1.2.3.4/old",
      "/dupe",
      "/dupe",
      "",
      "/weird~~seg__name;x=y",
    ].join("\n"),
    newUrls: [
      "/blog/new-post",
      "/about",
      "/shop/red shoes",
      "/deep/path",
      "/dupe-x",
      "/weird/seg/name;x=y",
    ].join("\n"),
  },
  {
    name: "M3 weak band + review suffix + query parity",
    oldUrls: ["/aa/bb/cc/dd", "/old?id=7&tab=2"].join("\n"),
    newUrls: ["/aa/bb/cc", "/new?id=7&tab=2"].join("\n"),
  },
];

let pass = 0;
let fail = 0;
for (const fx of FIXTURES) {
  const olds = splitList(fx.oldUrls);
  const news = splitList(fx.newUrls);

  // Rust side
  const res = await fetch(
    "http://127.0.0.1:3100/api/internal/tools/migration-map/run",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": TOKEN,
      },
      body: JSON.stringify({ olds: olds.map(shapeUrl), news: news.map(shapeUrl) }),
    },
  );
  const rust = await res.json();

  // Original TypeScript logic, in-process
  const map = buildMigrationMap({ oldUrls: olds, newUrls: news });
  const output = renderRedirectMap(map);
  const ts = { ok: true, map, output };

  const a = JSON.stringify(rust);
  const b = JSON.stringify(ts);
  if (a === b) {
    pass++;
    console.log(`IDENTICAL  ${fx.name}`);
  } else {
    fail++;
    console.log(`DIFF       ${fx.name}`);
    console.log(`  ts  : ${b}`);
    console.log(`  rust: ${a}`);
  }
}
console.log(`----\nmigration parity: ${pass} identical, ${fail} diff`);
process.exit(fail === 0 ? 0 : 1);
