/**
 * Browser-mode scrapers for AI search products that don't expose a
 * public API: Google AI Mode and Microsoft Copilot.
 *
 * Both are "run a query, extract the AI-generated answer + any inline
 * citation URLs, return them as a normalised response for the
 * llm-citation pipeline." No API keys — uses the existing browser
 * pool (Playwright with stealth + proxy rotation).
 *
 * BE HONEST: these products change their UI often. Selectors can
 * break within weeks. Every extraction path has fallbacks; when they
 * all miss we return an empty string + error message so the caller
 * knows to inspect a captured screenshot. UI changes are the
 * expected maintenance work for these scrapers.
 */

import { withBrowserContext } from "./browser-pool";
import { detectCaptcha, captchaUserMessage } from "./captcha-detect";

export type AiSearchScrapeResult = {
  ok: boolean;
  text: string;
  citations: string[];
  error?: string;
};

/**
 * Google AI Mode: the conversational overlay you land on with
 * `?udm=50`. Distinct from AI Overviews (which appear on regular
 * SERPs). AI Mode became default-on for many query types in mid-2026.
 */
export async function scrapeGoogleAiMode(
  query: string,
): Promise<AiSearchScrapeResult> {
  return withBrowserContext(async (context) => {
    const page = await context.newPage();
    try {
      // ?udm=50 is Google's stable identifier for the AI Mode surface.
      const url = `https://www.google.com/search?udm=50&hl=en&q=${encodeURIComponent(
        query,
      )}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // AI Mode streams its answer in — give the response block time
      // to fully render before extracting. 6-10s is typical.
      await page.waitForTimeout(8000);

      const html = await page.content();
      const cap = detectCaptcha(html);
      if (cap.blocked) {
        return {
          ok: false,
          text: "",
          citations: [],
          error: captchaUserMessage(cap.reason),
        };
      }

      // Extract the AI Mode answer block. Selectors are Google's
      // 2026 layout; expect to update these when the UI drifts.
      const result = await page.evaluate(() => {
        // Try selectors in priority order. Broadly targeting the
        // "generative response" containers Google uses on AI Mode
        // pages while avoiding sidebar / footer / nav noise.
        const containerSelectors = [
          "[data-attrid*='generative']",
          "[data-attrid*='answer']",
          "div[jsname='HxnHBe']",
          // Fallback: any large text block in the primary column
          "#center_col div[data-async-context]",
        ];
        let text = "";
        for (const sel of containerSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const t = (el as HTMLElement).innerText?.trim() ?? "";
            if (t.length > 200) {
              text = t;
              break;
            }
          }
        }
        // Extract every anchor URL inside the AI Mode area so we can
        // report inline citations. Google renders citations as anchors
        // inside footnote-style buttons.
        const citations: string[] = [];
        const anchors = document.querySelectorAll<HTMLAnchorElement>(
          "#center_col a[href^='http']",
        );
        const seen = new Set<string>();
        anchors.forEach((a) => {
          const href = a.href;
          if (!href || seen.has(href)) return;
          // Skip internal google.com links
          if (/^https?:\/\/(?:www\.)?google\./i.test(href)) return;
          seen.add(href);
          citations.push(href);
        });
        return { text, citations };
      });

      if (!result.text) {
        return {
          ok: false,
          text: "",
          citations: [],
          error:
            "Couldn't extract AI Mode response. Google's selectors have likely changed; " +
            "check the response captured in the screenshots/ folder or re-run.",
        };
      }
      return { ok: true, text: result.text, citations: result.citations };
    } catch (err) {
      return {
        ok: false,
        text: "",
        citations: [],
        error: (err as Error).message,
      };
    } finally {
      await page.close().catch(() => {});
    }
  });
}

/**
 * Microsoft Copilot: copilot.microsoft.com. Requires no sign-in for
 * anonymous queries as of mid-2026 (Bing rate-limits after ~5/min
 * for unauth users but that's fine for our low-cadence checks).
 */
export async function scrapeCopilot(
  query: string,
): Promise<AiSearchScrapeResult> {
  return withBrowserContext(async (context) => {
    const page = await context.newPage();
    try {
      // Copilot's URL structure: base + ?q= for a pre-populated query.
      const url = `https://copilot.microsoft.com/?q=${encodeURIComponent(query)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Copilot streams its response with a visible typing indicator.
      // Wait for stability: no new content for 2s.
      await page.waitForTimeout(10_000);

      const html = await page.content();
      const cap = detectCaptcha(html);
      if (cap.blocked) {
        return {
          ok: false,
          text: "",
          citations: [],
          error: captchaUserMessage(cap.reason),
        };
      }

      const result = await page.evaluate(() => {
        // Copilot 2026 markup: response bubbles are role="listitem" in
        // a chat log region. Prior versions used data-testid attrs.
        // Try multiple selectors.
        const selectors = [
          "[data-testid='conversation-turn'][data-turn-role='assistant']",
          "[role='listitem'][data-content]",
          "div[data-content='ai-message']",
          // Fallback: any long text block inside main content
          "main article",
        ];
        let text = "";
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length) {
            // Take the last assistant response (most recent)
            const last = els[els.length - 1] as HTMLElement;
            const t = last.innerText?.trim() ?? "";
            if (t.length > 200) {
              text = t;
              break;
            }
          }
        }
        // Copilot renders citations as numbered chips linking to sources
        const citations: string[] = [];
        const anchors = document.querySelectorAll<HTMLAnchorElement>(
          "main a[href^='http']",
        );
        const seen = new Set<string>();
        anchors.forEach((a) => {
          const href = a.href;
          if (!href || seen.has(href)) return;
          if (/^https?:\/\/(?:www\.)?(bing|microsoft)\./i.test(href)) return;
          seen.add(href);
          citations.push(href);
        });
        return { text, citations };
      });

      if (!result.text) {
        return {
          ok: false,
          text: "",
          citations: [],
          error:
            "Couldn't extract Copilot response. Selectors likely need updating for " +
            "the current Copilot UI. Check screenshots/ folder or re-run.",
        };
      }
      return { ok: true, text: result.text, citations: result.citations };
    } catch (err) {
      return {
        ok: false,
        text: "",
        citations: [],
        error: (err as Error).message,
      };
    } finally {
      await page.close().catch(() => {});
    }
  });
}
