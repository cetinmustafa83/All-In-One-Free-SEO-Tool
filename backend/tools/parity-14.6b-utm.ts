/**
 * Task 14.6b — compute parity harness, part 1: utm-attribution.
 *
 * Runs the ORIGINAL TypeScript logic (extracted verbatim from
 * `git show HEAD:src/app/tools/utm-attribution/actions.ts` — guardAction and
 * saveToolRun are stripped textually; everything else is the untouched
 * action body) against the ported Rust endpoint
 * /api/internal/tools/utm-attribution/run on the same fixtures, and diffs
 * the JSON results byte-for-byte.
 *
 * Usage: bun backend/tools/parity-14.6b-utm.ts   (backend on :3100)
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const ROOT = execSync("git rev-parse --show-toplevel").toString().trim();
const orig = execSync(
  `git show HEAD:src/app/tools/utm-attribution/actions.ts`,
  { cwd: ROOT },
).toString();

// ---- text surgery: keep the action body, drop guard/save ----
const start = orig.indexOf("export type UtmTouch");
const end = orig.indexOf("export type AttrState");
if (start < 0 || end < 0) throw new Error("markers not found");
const block = orig.slice(start, end);

const fnStart = orig.indexOf("export async function runAttribution");
if (fnStart < 0) throw new Error("action not found");
let fn = orig.slice(fnStart);
fn = fn.replace(
  /export async function runAttribution\([\s\S]*?\): Promise<AttrState> \{/,
  "export function runAttributionPure(raw: string): AttrState {",
);
fn = fn.replace(
  /\s*await guardAction\("edit", formData\.get\("clientId"\)\);\s*\n\s*const raw = String\(formData\.get\("touches"\) \?\? ""\)\.trim\(\);/,
  "",
);
fn = fn.replace(
  /\s*await saveToolRun\(\{[\s\S]*?\}\)\.catch\(\(\) => undefined\);/,
  "",
);

const moduleSrc = `${block}\n${fn}\n`;
const modPath = "/tmp/parity-utm-original.ts";
writeFileSync(modPath, moduleSrc);
const { runAttributionPure } = await import(modPath);

const TOKEN = execSync(
  `cat "${ROOT}/data/.seo-internal-token" 2>/dev/null || cat "${ROOT}/.seo-internal-token"`,
).toString().trim();

const FIXTURES: { name: string; touches: string }[] = [
  {
    name: "F1 header-CSV CRLF quoted conversions",
    touches:
      'timestamp,source,medium,campaign,userId,isConversion\r\n' +
      '2024-01-01T00:00:00.000Z,google,cpc,Brand,u1,1\r\n' +
      '2024-01-02T00:00:00.000Z,google,organic,Brand,u1,\r\n' +
      '2024-01-03T00:00:00.000Z,"facebook",paid_social,Spring,u2,1\r\n' +
      '2024-01-04T00:00:00.000Z,newsletter,email,Launch,u2,\r\n' +
      '2024-01-05T00:00:00.000Z,,(none),Direct,u2,\r\n',
  },
  {
    name: "F2 no-header positional tab-separated anon users",
    touches:
      'userA,google,organic,G\n' +
      'userA,facebook,social,F\n' +
      'userB,newsletter,email,N\n' +
      'userB,,(none),D\n' +
      'userC,bing,cpc,B\n' +
      'userC,bing,cpc,B\n',
  },
  {
    name: "F3 quoted header unsorted timestamps conversion column",
    touches:
      '"timestamp","source","medium","campaign","userId","conversion"\n' +
      '\n' +
      '2024-01-05T00:00:00.000Z,facebook,paidsocial,Spring,u9,1\n' +
      '2024-01-02T00:00:00.000Z,google,cpc,Q,u9,0\n' +
      '2024-01-03T00:00:00.000Z,reddit,referral,R,u8,0\n' +
      '2024-01-04T00:00:00.000Z,display,display,D,u8,0\n' +
      '2024-01-04T00:00:00.000Z,x,video,V,u8,0\n' +
      '  ,  ,  ,  ,  ,  \n' +
      'stray-only-column\n',
  },
  {
    name: "F4 direct-call empty string",
    touches: '',
  },
  {
    name: "F5 unparsable single junk line",
    touches: 'just-one-cell-with-no-columns',
  },
];

let pass = 0;
let fail = 0;
for (const fx of FIXTURES) {
  const expected = runAttributionPure(fx.touches);
  const res = await fetch(
    "http://127.0.0.1:3100/api/internal/tools/utm-attribution/run",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": TOKEN,
      },
      body: JSON.stringify({ touches: fx.touches }),
    },
  );
  const actual = await res.json();
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
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
console.log(`----\nutm parity: ${pass} identical, ${fail} diff`);
process.exit(fail === 0 ? 0 : 1);
