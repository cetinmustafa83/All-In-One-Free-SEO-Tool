/**
 * Task 14.5b — generates backend/src/client_templates.rs from the
 * TypeScript template-data modules. Run: bun backend/tools/gen-templates.ts
 *
 * The data must stay byte-identical to the Next libs, so it is EXTRACTED,
 * not hand-copied. Re-run this whenever the source data changes.
 */
import { writeFileSync } from "node:fs";
import { nicheTemplates } from "../../src/lib/niche-templates";
import {
  pickStackTemplates,
  getTemplatesByKey,
} from "../../src/lib/tech-stack-templates";

const STACK_KEYS = [
  "wordpress",
  "shopify",
  "wix",
  "squarespace",
  "webflow",
  "nextjs",
  "drupal",
  "magento",
  "woocommerce",
  "custom",
] as const;

/**
 * detectionLabelToKey is module-private in the source; the map is small and
 * stable (tech-detect rule names → stack keys), so it is reproduced here and
 * VERIFIED against pickStackTemplates() below — the build fails loudly if
 * the source mapping ever drifts.
 */
const DETECTION_LABEL_TO_KEY: Record<string, string> = {
  WordPress: "wordpress",
  Shopify: "shopify",
  Wix: "wix",
  Squarespace: "squarespace",
  Webflow: "webflow",
  "Next.js": "nextjs",
  Drupal: "drupal",
  Magento: "magento",
  WooCommerce: "woocommerce",
};
for (const [label, key] of Object.entries(DETECTION_LABEL_TO_KEY)) {
  const picked = pickStackTemplates([label]);
  if (!picked.matched.includes(key as never) || picked.tasks.length === 0) {
    throw new Error(`detection label map drift: ${label} → ${key}`);
  }
}

type Template = {
  title: string;
  description: string;
  whyItMatters: string;
  priority: string;
};

function lit(s: string): string {
  return `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;
}

function emit(name: string, docs: string, items: Template[]): string {
  const rows = items
    .map(
      (t) =>
        `    Template { title: ${lit(t.title)}, description: ${lit(
          t.description,
        )}, why_it_matters: ${lit(t.whyItMatters)}, priority: ${lit(t.priority)} },`,
    )
    .join("\n");
  return `${docs}pub static ${name}: &[Template] = &[
${rows}
];
`;
}

const out: string[] = [
  `//! GENERATED FILE — backend/src/client_templates.rs (Task 14.5b).
//! Source of truth: src/lib/niche-templates.ts (niche data) and
//! src/lib/tech-stack-templates.ts (stack data + detection-label map).
//! Regenerate with: bun backend/tools/gen-templates.ts
//! Do NOT edit by hand — the smoke tests assert parity via the generator.

/// One task-template row (structurally NicheTaskTemplate / StackTaskTemplate).
pub struct Template {
    pub title: &'static str,
    pub description: &'static str,
    pub why_it_matters: &'static str,
    pub priority: &'static str,
}

// ── Niche templates (src/lib/niche-templates.ts) ────────────────────────────
`,
];

const nicheKeys = Object.keys(nicheTemplates) as (keyof typeof nicheTemplates)[];
for (const k of nicheKeys) {
  out.push(
    emit(
      `NICHE_${k.replace(/[^a-z]/g, "_").toUpperCase()}`,
      "",
      nicheTemplates[k] as unknown as Template[],
    ),
  );
}

out.push(`/// getNicheTemplates(niche) — unknown/null niches get nothing.
pub fn niche_templates(niche: Option<&str>) -> &'static [Template] {
    match niche {
        Some("local") => NICHE_LOCAL,
        Some("ecommerce") => NICHE_ECOMMERCE,
        Some("saas") => NICHE_SAAS,
        Some("blog") => NICHE_BLOG,
        Some("services") => NICHE_SERVICES,
        _ => &[],
    }
}

// ── Tech-stack templates (src/lib/tech-stack-templates.ts) ──────────────────
`);

for (const k of STACK_KEYS) {
  out.push(
    emit(
      `STACK_${k.replace(/[^a-z]/g, "_").toUpperCase()}`,
      "",
      getTemplatesByKey(k) as unknown as Template[],
    ),
  );
}

out.push(`/// detectionLabelToKey + templates, fused: a detected label → its rows.
pub fn stack_templates_for_label(label: &str) -> Option<&'static [Template]> {
    match label {
`);
for (const [detected, key] of Object.entries(DETECTION_LABEL_TO_KEY)) {
  out.push(
    `        ${JSON.stringify(detected).replace(/"/g, '"')} => Some(STACK_${String(key).replace(/[^a-z]/g, "_").toUpperCase()}),`,
  );
}
out.push(`        _ => None,
    }
}

/// pickStackTemplates(detectedStack): every matched platform's rows in
/// detection order; falls back to the "custom" set when nothing matched.
pub fn pick_stack_templates(detected: Option<&[String]>) -> Vec<&'static Template> {
    let mut out: Vec<&'static Template> = Vec::new();
    let mut matched = false;
    if let Some(labels) = detected {
        for label in labels {
            if let Some(rows) = stack_templates_for_label(label) {
                matched = true;
                out.extend(rows.iter());
            }
        }
    }
    if !matched {
        out.extend(STACK_CUSTOM.iter());
    }
    out
}
`);

writeFileSync(
  new URL("../src/client_templates.rs", import.meta.url).pathname,
  out.join("\n"),
);
console.log("wrote backend/src/client_templates.rs");
