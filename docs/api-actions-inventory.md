# Server Actions Inventory (Task 14.1)

> **Generated file** — regenerate: `bun backend/tools/api-inventory.ts`
> 22 action files · 46 exported functions. R5 wrappers keep call sites stable.

## Page actions

| Route area | File | # | Exported functions |
|---|---|---|---|
| `/audits` | `src/app/audits/fix-actions.ts` | 1 | getFixSuggestions |
| `/audits` | `src/app/audits/issue-actions.ts` | 2 | setIssueStatus, setStatusForType |
| `/` | `src/app/autonomy-actions.ts` | 1 | chooseAutonomyAction |
| `/backlinks` | `src/app/backlinks/bing-actions.ts` | 1 | importBingBacklinksAction |
| `/clients/[id]` | `src/app/clients/[id]/google-actions.ts` | 2 | fetchGoogleProperties, saveGoogleProperties |
| `/clients/[id]` | `src/app/clients/[id]/schedule-actions.ts` | 3 | deleteSchedule, saveSchedule, sendReportNow |
| `/clients/[id]` | `src/app/clients/[id]/wp-actions.ts` | 4 | disconnectWpBridge, pushImageAltFix, pushWpFix, saveWpCreds |
| `/clients` | `src/app/clients/import-actions.ts` | 1 | importClientsCsv |
| `/clients` | `src/app/clients/share-actions.ts` | 3 | emailPortalLink, generateShareToken, revokeShareToken |
| `/gbp/c/[clientId]` | `src/app/gbp/c/[clientId]/playbook-actions.ts` | 2 | getCompletionsForClient, togglePlaybookItem |
| `/keywords` | `src/app/keywords/import-actions.ts` | 1 | importKeywords |
| `/keywords` | `src/app/keywords/rank-actions.ts` | 3 | checkAllRanksAction, checkRankAction, clearRankHistoryAction |
| `/keywords` | `src/app/keywords/serp-actions.ts` | 1 | runSerpScan |
| `/portal/[token]` | `src/app/portal/[token]/chat-actions.ts` | 1 | portalChat |
| `/reports/c/[clientId]` | `src/app/reports/c/[clientId]/preview-actions.ts` | 1 | previewExecSummary |
| `/settings` | `src/app/settings/brand-actions.ts` | 2 | clearLogo, saveBrand |
| `/settings` | `src/app/settings/browser-actions.ts` | 3 | loadBrowserSettings, saveBrowserSettings, testProxies |
| `/settings` | `src/app/settings/key-actions.ts` | 4 | saveApiKey, saveOllamaUrl, setActiveProvider, setCreditSaverEnabled |
| `/settings` | `src/app/settings/smtp-actions.ts` | 4 | clearSmtpConfig, saveSmtpConfig, sendTestEmail, testSmtpConnection |
| `/settings` | `src/app/settings/theme-actions.ts` | 3 | cycleTheme, getThemePreference, setThemePreference |
| `/settings` | `src/app/settings/timezone-actions.ts` | 1 | saveWorkspaceTimeZone |
| `/settings` | `src/app/settings/ui-actions.ts` | 2 | getUiMode, setUiMode |

## API-area actions

| Route area | File | # | Exported functions |
|---|---|---|---|

