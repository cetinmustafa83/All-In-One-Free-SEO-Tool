import { Bot } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { AiRobotsForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * AI-bot robots.txt audit tool. Paste a URL, get:
 *   - Which of the 15 known AI crawlers your robots.txt actually
 *     addresses (vs falls under the * wildcard, vs missing entirely)
 *   - Whether each one is currently allowed or blocked
 *   - A copy-paste patch block with recommended rules for the ones
 *     you're not addressing explicitly today
 *
 * Why this matters: as of 2026, 10+ major LLM crawlers ignore a plain
 * User-agent: * for opt-out purposes. Explicit rules are the only
 * reliable way to control what enters LLM training corpora.
 */
export default function AiRobotsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="AI-bot robots.txt audit"
        description="Check whether your robots.txt explicitly addresses ChatGPT, Claude, Gemini, Perplexity, and the 10+ other AI crawlers. Generates a copy-paste patch for the ones you're not covering."
        icon={Bot}
        accent="violet"
      />

      <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 px-4 py-3 text-[12px] leading-relaxed text-violet-100/90">
        <div className="font-semibold text-violet-200">
          Why a wildcard block isn&apos;t enough
        </div>
        <p className="mt-1 opacity-90">
          Most AI crawlers explicitly document that <code>User-agent: *</code>{" "}
          alone doesn&apos;t opt content out of their training set — they
          require their vendor-specific UA to be named. GPTBot ignores the
          wildcard for training purposes. Google-Extended is a separate
          knob from Googlebot. Applebot-Extended is separate from Applebot.
          This tool audits each known AI UA individually and generates
          the exact directives you need.
        </p>
      </div>

      <AiRobotsForm />
    </div>
  );
}
