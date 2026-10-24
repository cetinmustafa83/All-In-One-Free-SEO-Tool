#!/usr/bin/env bun
/**
 * Parity harness — Task 14.1. Compares Next.js (:3000) and Rust (:3100)
 * responses for the probe set in backend/parity-probes.json.
 *
 * Server-side tool: absolute localhost URLs are fine here (the "relative path
 * only" rule applies to browser-side frontend code, per gateway rules).
 *
 *   bun backend/tools/parity.ts             # run probes
 *   NEXT=http://127.0.0.1:3000 RUST=http://127.0.0.1:3100 bun backend/tools/parity.ts
 *
 * Probe fields: name, path, method?, headers?, body?, expect{next, rust},
 * rust: number | "mirror" (= same status as next) | "skip". compareKeys:
 * when both return 200 JSON objects, their top-level key sets must match —
 * used once a domain is ported so both stacks serve the same contract.
 * exactBody: raw response-body text must be identical on both stacks —
 * for deterministic endpoints (no timestamps), stricter than compareKeys.
 */
type Probe = {
  name: string;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  expect: { next: number; rust: number | "mirror" | "skip" };
  compareKeys?: boolean;
  exactBody?: boolean;
};

const NEXT = process.env.NEXT ?? "http://127.0.0.1:3000";
const RUST = process.env.RUST ?? "http://127.0.0.1:3100";
const file = new URL("../parity-probes.json", import.meta.url);
const probes: Probe[] = JSON.parse(await Bun.file(file).text());

type Res = { status: number; keys: string[] | null; text: string | null };
async function hit(base: string, p: Probe): Promise<Res> {
  try {
    const r = await fetch(base + p.path, {
      method: p.method ?? "GET",
      headers: p.headers ?? {},
      body: p.body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await r.text();
    let keys: string[] | null = null;
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        const body = JSON.parse(text);
        if (body && typeof body === "object" && !Array.isArray(body)) keys = Object.keys(body).sort();
      } catch {
        /* non-JSON body despite header */
      }
    }
    return { status: r.status, keys, text };
  } catch {
    return { status: 0, keys: null, text: null };
  }
}

let pass = 0;
let fail = 0;
const rows: string[] = [];
console.log(
  "PROBE".padEnd(30) + "PATH".padEnd(30) + "NEXT(exp/act)".padEnd(14) + "RUST(exp/act)".padEnd(14) + "KEYS  VERDICT",
);
for (const p of probes) {
  const n = await hit(NEXT, p);
  const rustExpect = p.expect.rust;
  const r = rustExpect === "skip" ? { status: -1, keys: null } : await hit(RUST, p);
  const okNext = n.status === p.expect.next;
  const okRust =
    rustExpect === "skip"
      ? true
      : rustExpect === "mirror"
        ? r.status === n.status
        : r.status === rustExpect;
  let keyNote = "—";
  let okKeys = true;
  if (p.exactBody) {
    const same = n.status === r.status && n.text !== null && n.text === r.text;
    okKeys = same;
    keyNote = same
      ? "exact"
      : `body diff: next=${JSON.stringify(n.text?.slice(0, 120))} rust=${JSON.stringify(r.text?.slice(0, 120))}`;
  } else if (p.compareKeys) {
    if (n.status === 200 && r.status === 200 && n.keys && r.keys) {
      const same = n.keys.length === r.keys.length && n.keys.every((k, i) => k === r.keys[i]);
      okKeys = same;
      keyNote = same ? "match" : `diff: [${r.keys.join(",")}] vs [${n.keys.join(",")}]`;
    } else {
      okKeys = false;
      keyNote = "bodies not comparable";
    }
  }
  const ok = okNext && okRust && okKeys;
  ok ? pass++ : fail++;
  rows.push(
    `${ok ? "PASS" : "FAIL"}  ${p.name}  next=${n.status}/${p.expect.next} rust=${r.status === -1 ? "skip" : r.status}/${rustExpect}${p.compareKeys ? ` keys=${keyNote}` : ""}`,
  );
  console.log(
    p.name.padEnd(30) +
      p.path.padEnd(30) +
      `${p.expect.next}/${n.status}`.padEnd(14) +
      `${rustExpect === "skip" ? "skip" : rustExpect}/${r.status === -1 ? "-" : r.status}`.padEnd(14) +
      keyNote.padEnd(6) +
      (ok ? "PASS" : "FAIL"),
  );
}
console.log("-".repeat(90));
for (const row of rows.filter((x) => x.startsWith("FAIL"))) console.log("  " + row);
console.log(`${pass} passed, ${fail} failed (${probes.length} probes) — next=${NEXT} rust=${RUST}`);
process.exit(fail > 0 ? 1 : 0);
