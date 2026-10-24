# Server Actions Inventory (Task 14.1)

> **Generated file** — regenerate: `bun backend/tools/api-inventory.ts`
> 158 action files · 376 exported functions. R5 wrappers keep call sites stable.

## Page actions

| Route area | File | # | Exported functions |
|---|---|---|---|
| `/ads` | `src/app/ads/actions.ts` | 8 | addAdAccount, clearSnapshots, deleteAdAccount, resolveProposal, resumeAdAccount, runEngineNow, syncDemoData, updateGuardrails |
| `/agent` | `src/app/agent/actions.ts` | 6 | applySuggestion, dismissSuggestion, reopenSuggestion, runAgent, runAgentExecute, suggestionToTask |
| `/agent/autopilot` | `src/app/agent/autopilot/actions.ts` | 9 | approveAction, approveAllOfKind, rejectAction, runNow, saveAgentSettings, setLevel, undoAction, undoRun, waitingByKind |
| `/ai-visibility` | `src/app/ai-visibility/actions.ts` | 4 | deleteVisibilityCheck, runAiCheck, runAllAiChecks, setBrowserScrapedAiEnabled |
| `/algorithm-updates` | `src/app/algorithm-updates/actions.ts` | 1 | refreshGoogleUpdatesAction |
| `/annotations` | `src/app/annotations/actions.ts` | 3 | addAnnotation, fetchAnnotations, removeAnnotation |
| `/ask` | `src/app/ask/actions.ts` | 1 | askTheTool |
| `/assistant` | `src/app/assistant/actions.ts` | 1 | chat |
| `/audits` | `src/app/audits/actions.ts` | 1 | runAuditForClient |
| `/author-authority` | `src/app/author-authority/actions.ts` | 2 | listAuthorRecords, runAuthorScan |
| `/automations` | `src/app/automations/actions.ts` | 5 | createAutomation, deleteAutomation, installWorkflowTemplate, setAutomationEnabled, testWebhook |
| `/backlinks` | `src/app/backlinks/actions.ts` | 5 | addBacklink, deleteBacklink, importAhrefsBacklinks, logBuiltLink, setBacklinkStatus |
| `/bot-logs` | `src/app/bot-logs/actions.ts` | 3 | deleteUpload, listUploads, parseAndStoreLog |
| `/brand-monitor` | `src/app/brand-monitor/actions.ts` | 3 | deleteMention, mentionToOutreach, runBrandMonitor |
| `/brand-serp` | `src/app/brand-serp/actions.ts` | 1 | captureBrandSerp |
| `/broken-links` | `src/app/broken-links/actions.ts` | 1 | checkUrl |
| `/capture` | `src/app/capture/actions.ts` | 3 | captureUrl, saveAsCompetitor, saveAsMonitoredPage |
| `/chats` | `src/app/chats/actions.ts` | 6 | clearChats, deleteChat, fetchChat, fetchChats, pinChat, renameChat |
| `/citations` | `src/app/citations/actions.ts` | 1 | setStatusForm |
| `/clients/[id]/ai-audit` | `src/app/clients/[id]/ai-audit/actions.ts` | 3 | saveIssueNotes, startAiAudit, toggleResolved |
| `/clients/[id]/automations` | `src/app/clients/[id]/automations/actions.ts` | 4 | createSchedule, deleteSchedule, runScheduleNow, toggleScheduleEnabled |
| `/clients/[id]/onboarding` | `src/app/clients/[id]/onboarding/actions.ts` | 9 | acceptDiscoveredKeywords, generateMonthlyCalendar, getAuditProgress, getLearnedRulesForClient, runKeywordDiscovery, saveBrandStep, saveSurfacesStep, saveTargetingStep, skipOnboarding |
| `/clients/[id]/queue` | `src/app/clients/[id]/queue/actions.ts` | 4 | approveAndPublishNow, approveQueueItem, deleteQueueItem, rejectQueueItem |
| `/clients` | `src/app/clients/actions.ts` | 10 | applyNicheTemplates, applyStackTemplates, createClient, deleteClient, fetchClientMetadata, quickAddClient, redetectTechStack, refreshClientMetadata, refreshClientMetadataForm, updateClient |
| `/clients/import` | `src/app/clients/import/actions.ts` | 2 | importSelectedProperties, listImportableProperties |
| `/compare` | `src/app/compare/actions.ts` | 1 | compareDomains |
| `/competitors` | `src/app/competitors/actions.ts` | 2 | addCompetitor, deleteCompetitor |
| `/competitors/playbook` | `src/app/competitors/playbook/actions.ts` | 2 | playbookToTasks, runCompetitorAnalysis |
| `/content-gap` | `src/app/content-gap/actions.ts` | 1 | analyzeContentGap |
| `/csv-import` | `src/app/csv-import/actions.ts` | 2 | importCsv, previewCsv |
| `/cwv` | `src/app/cwv/actions.ts` | 2 | deleteCwvReport, runCwvScan |
| `/digest` | `src/app/digest/actions.ts` | 3 | loadDigestSettings, sendDigest, setSchedule |
| `/embed/grader` | `src/app/embed/grader/actions.ts` | 3 | captureLead, gradeForVisitor, publicGrade |
| `/gbp` | `src/app/gbp/actions.ts` | 7 | composeGbpPost, generateGbpPostIdeas, generateReviewReply, loadGbpForClient, pingGbpLocation, postGbpReply, runGbpScrape |
| `/gbp/c/[clientId]/reviews` | `src/app/gbp/c/[clientId]/reviews/actions.ts` | 8 | chooseLocation, draftNextReplies, listLocationChoices, loadReviewDesk, publishAllDrafts, publishReply, saveDraft, syncReviews |
| `/grader` | `src/app/grader/actions.ts` | 1 | gradeSite |
| `/guest-posts/c/[clientId]` | `src/app/guest-posts/c/[clientId]/actions.ts` | 7 | deleteDraft, generateGuestPost, listDraftsForClient, setDraftLiveUrl, setDraftStatus, suggestGuestPostTitles, updateDraftMarkdown |
| `/image-audit` | `src/app/image-audit/actions.ts` | 1 | runImageAudit |
| `/import` | `src/app/import/actions.ts` | 1 | extractScreenshotText |
| `/invoices` | `src/app/invoices/actions.ts` | 4 | createInvoice, deleteInvoice, getNextInvoiceNumber, setInvoiceStatus |
| `/keywords` | `src/app/keywords/actions.ts` | 3 | researchAction, trackKeyword, untrackKeyword |
| `/knowledge-panel` | `src/app/knowledge-panel/actions.ts` | 2 | listKpSnapshots, runKpCapture |
| `/leads` | `src/app/leads/actions.ts` | 4 | convertLeadToClient, deleteLead, setLeadNotes, setLeadStatus |
| `/link-building` | `src/app/link-building/actions.ts` | 4 | deleteSubmission, setSubmissionStatus, setSubmittedUrl, trackResource |
| `/link-building/c/[clientId]` | `src/app/link-building/c/[clientId]/actions.ts` | 7 | bulkTrackResources, fetchBespokeIdeas, removeForClient, runLinkHealthCheck, setLiveUrlForClient, setStatusForClient, trackBespokeIdea |
| `/link-building/prospects` | `src/app/link-building/prospects/actions.ts` | 2 | findLinkProspects, trackProspect |
| `/links` | `src/app/links/actions.ts` | 3 | createShortLink, deleteShortLink, importShortLinksCsv |
| `/local-grid` | `src/app/local-grid/actions.ts` | 6 | createGridSchedule, deleteGridSchedule, getRecentGrids, listGridSchedules, runGrid, toggleGridSchedule |
| `/local-rank` | `src/app/local-rank/actions.ts` | 1 | runLocalRanks |
| `/meta-rewrite` | `src/app/meta-rewrite/actions.ts` | 2 | applyRewrite, findCandidates |
| `/monitor` | `src/app/monitor/actions.ts` | 5 | addMonitoredPage, checkAllMonitoredPages, checkPageChanges, deleteMonitoredPage, setMonitorStatus |
| `/news` | `src/app/news/actions.ts` | 9 | addFeed, cleanupOldItems, clearAllItems, deleteOneItem, listRecentItems, refreshFeeds, removeFeed, seedDefaultFeedsIfEmpty, toggleFeed |
| `/notifications` | `src/app/notifications/actions.ts` | 1 | recentNotifications |
| `/outreach` | `src/app/outreach/actions.ts` | 10 | addOutreachContact, deleteOutreachContact, deleteOutreachTemplate, loadMessagesForContact, loadTemplatesForClient, saveOutreachTemplate, seedDefaultTemplatesIfEmpty, sendOutreachAction, setContactStatus, setSenderName |
| `/proposals` | `src/app/proposals/actions.ts` | 5 | buildKickoffReport, buildProposal, createProposal, deleteProposal, updateProposal |
| `/report-data` | `src/app/report-data/actions.ts` | 3 | deleteEntry, listForClient, parseReportDataPaste |
| `/reports/archive` | `src/app/reports/archive/actions.ts` | 2 | deleteArchivedReport, pinArchivedReport |
| `/reports/batch` | `src/app/reports/batch/actions.ts` | 5 | approveReport, pollBatch, rejectReport, sendReport, startBatch |
| `/search` | `src/app/search/actions.ts` | 1 | search |
| `/seo-chat` | `src/app/seo-chat/actions.ts` | 1 | seoChat |
| `/settings` | `src/app/settings/actions.ts` | 3 | saveDefaultModel, saveWebhookUrl, testWebhook |
| `/settings/ai-learning` | `src/app/settings/ai-learning/actions.ts` | 3 | deletePreference, runDistill, togglePreference |
| `/settings/ai-usage` | `src/app/settings/ai-usage/actions.ts` | 1 | saveCap |
| `/settings/api-keys` | `src/app/settings/api-keys/actions.ts` | 2 | createApiKey, revokeApiKey |
| `/settings/edge` | `src/app/settings/edge/actions.ts` | 1 | rotateEdgeTokenAction |
| `/settings/errors` | `src/app/settings/errors/actions.ts` | 2 | clearResolvedAction, resolveErrorAction |
| `/settings/google` | `src/app/settings/google/actions.ts` | 6 | clearGoogleCredentials, disconnectGoogleAccount, removeServiceAccount, saveGoogleCredentials, saveServiceAccount, testServiceAccount |
| `/settings/inbound-webhooks` | `src/app/settings/inbound-webhooks/actions.ts` | 3 | createInboundWebhook, deleteInboundWebhook, toggleInboundWebhook |
| `/settings/team` | `src/app/settings/team/actions.ts` | 5 | cancelInvite, changeRole, inviteMember, setActive, setClientAccess |
| `/tasks` | `src/app/tasks/actions.ts` | 10 | applyPlaybookToClient, bulkDeleteTasks, bulkSetTaskPriority, bulkSetTaskStatus, createTask, deleteTask, logTaskTime, setTaskEstimate, setTaskRecurrence, setTaskStatus |
| `/title-tests` | `src/app/title-tests/actions.ts` | 3 | cancelTitleTest, createTitleTest, deleteTitleTest |
| `/tools/ads-funnel` | `src/app/tools/ads-funnel/actions.ts` | 1 | generateAdsFunnel |
| `/tools/ai-overview` | `src/app/tools/ai-overview/actions.ts` | 1 | analyzeAiOverview |
| `/tools/ai-robots` | `src/app/tools/ai-robots/actions.ts` | 1 | runAiRobotsAudit |
| `/tools/ai-schema` | `src/app/tools/ai-schema/actions.ts` | 1 | runAiSchema |
| `/tools/aio-passage` | `src/app/tools/aio-passage/actions.ts` | 4 | analyzePassages, analyzeUrl, batchRewrite, suggestRewrite |
| `/tools/anchor-distribution` | `src/app/tools/anchor-distribution/actions.ts` | 1 | runAnchor |
| `/tools/auto-link` | `src/app/tools/auto-link/actions.ts` | 1 | runAutoLink |
| `/tools/backlink-discovery` | `src/app/tools/backlink-discovery/actions.ts` | 1 | runBacklinkDiscovery |
| `/tools/bing` | `src/app/tools/bing/actions.ts` | 5 | clearBingKey, fetchBingInsights, fetchBingSites, saveBingKey, submitBingUrls |
| `/tools/branded-split` | `src/app/tools/branded-split/actions.ts` | 1 | runSplit |
| `/tools/browser-agent` | `src/app/tools/browser-agent/actions.ts` | 1 | runAgent |
| `/tools/bulk-alt` | `src/app/tools/bulk-alt/actions.ts` | 1 | runBulkAlt |
| `/tools/bulk-scan` | `src/app/tools/bulk-scan/actions.ts` | 1 | runBulkScan |
| `/tools/cannibalization` | `src/app/tools/cannibalization/actions.ts` | 1 | runCannibalScan |
| `/tools/canonical-audit` | `src/app/tools/canonical-audit/actions.ts` | 1 | runCanonical |
| `/tools/cluster` | `src/app/tools/cluster/actions.ts` | 1 | runCluster |
| `/tools/code-generator` | `src/app/tools/code-generator/actions.ts` | 1 | generateCode |
| `/tools/content-grader` | `src/app/tools/content-grader/actions.ts` | 1 | gradeContent |
| `/tools/content-helpers` | `src/app/tools/content-helpers/actions.ts` | 2 | getCategorySuggestions, getCoverImagePrompts |
| `/tools/content-score` | `src/app/tools/content-score/actions.ts` | 2 | saveContentScoreSnapshot, scoreContent |
| `/tools/crux` | `src/app/tools/crux/actions.ts` | 3 | runCrux, runCruxHistory, runOriginSummary |
| `/tools/disavow` | `src/app/tools/disavow/actions.ts` | 1 | runDisavow |
| `/tools/dns-whois` | `src/app/tools/dns-whois/actions.ts` | 1 | runDns |
| `/tools/domain-overview` | `src/app/tools/domain-overview/actions.ts` | 1 | runDomainOverview |
| `/tools/eeat-audit` | `src/app/tools/eeat-audit/actions.ts` | 1 | runEeatAudit |
| `/tools/facet-trap` | `src/app/tools/facet-trap/actions.ts` | 1 | runFacetTrap |
| `/tools/freshness` | `src/app/tools/freshness/actions.ts` | 1 | runFreshnessAudit |
| `/tools/gbp-reply` | `src/app/tools/gbp-reply/actions.ts` | 3 | fetchReviewsWithDrafts, listReplyLocations, submitReply |
| `/tools/geo-score` | `src/app/tools/geo-score/actions.ts` | 1 | runGeoScore |
| `/tools/github-pr` | `src/app/tools/github-pr/actions.ts` | 1 | runOpenPr |
| `/tools/gsc-coverage` | `src/app/tools/gsc-coverage/actions.ts` | 2 | analyzeFixesForCoverage, runCoverage |
| `/tools/headers` | `src/app/tools/headers/actions.ts` | 2 | inspectHeaders, saveHeadersSnapshot |
| `/tools/health-check` | `src/app/tools/health-check/actions.ts` | 2 | runHealthCheck, saveHealthSnapshot |
| `/tools/hreflang` | `src/app/tools/hreflang/actions.ts` | 1 | checkHreflang |
| `/tools/image-gen` | `src/app/tools/image-gen/actions.ts` | 1 | runImageGen |
| `/tools/indexnow` | `src/app/tools/indexnow/actions.ts` | 2 | submitIndexNow, verifyIndexNowKeyFile |
| `/tools/intent-classifier` | `src/app/tools/intent-classifier/actions.ts` | 1 | runClassify |
| `/tools/internal-linking` | `src/app/tools/internal-linking/actions.ts` | 1 | suggestInternalLinks |
| `/tools/keyword-difficulty` | `src/app/tools/keyword-difficulty/actions.ts` | 1 | estimateDifficulty |
| `/tools/link-checker` | `src/app/tools/link-checker/actions.ts` | 1 | analyzeLinks |
| `/tools/link-graph` | `src/app/tools/link-graph/actions.ts` | 1 | runLinkGraph |
| `/tools/link-intersect` | `src/app/tools/link-intersect/actions.ts` | 1 | runLinkIntersect |
| `/tools/link-recommender` | `src/app/tools/link-recommender/actions.ts` | 1 | recommendLinks |
| `/tools/llms-txt` | `src/app/tools/llms-txt/actions.ts` | 2 | generateLlmsTxt, validateLlmsTxt |
| `/tools/local-cwv` | `src/app/tools/local-cwv/actions.ts` | 1 | runLocalCwv |
| `/tools/meta-tag-generator` | `src/app/tools/meta-tag-generator/actions.ts` | 1 | generateMetaTags |
| `/tools/migration-map` | `src/app/tools/migration-map/actions.ts` | 2 | importToRedirectRules, runMapping |
| `/tools/migration-parity` | `src/app/tools/migration-parity/actions.ts` | 1 | runParity |
| `/tools/mobile-friendly` | `src/app/tools/mobile-friendly/actions.ts` | 1 | runMobile |
| `/tools/news-headline` | `src/app/tools/news-headline/actions.ts` | 1 | runHeadline |
| `/tools/og-image` | `src/app/tools/og-image/actions.ts` | 1 | runOgImage |
| `/tools/outreach-personalize` | `src/app/tools/outreach-personalize/actions.ts` | 1 | runPersonalize |
| `/tools/pagerank` | `src/app/tools/pagerank/actions.ts` | 1 | runPagerank |
| `/tools/perf-budget` | `src/app/tools/perf-budget/actions.ts` | 1 | runBudget |
| `/tools/person-schema` | `src/app/tools/person-schema/actions.ts` | 1 | savePersonSchema |
| `/tools/plagiarism` | `src/app/tools/plagiarism/actions.ts` | 1 | checkPlagiarism |
| `/tools/programmatic-seo` | `src/app/tools/programmatic-seo/actions.ts` | 1 | runProgram |
| `/tools/rank-where` | `src/app/tools/rank-where/actions.ts` | 1 | checkRank |
| `/tools/reddit-research` | `src/app/tools/reddit-research/actions.ts` | 1 | searchReddit |
| `/tools/redirects-bulk` | `src/app/tools/redirects-bulk/actions.ts` | 1 | runBulk |
| `/tools/redirects-manager` | `src/app/tools/redirects-manager/actions.ts` | 5 | addRule, deleteNotFound, deleteRule, record404, resolve404 |
| `/tools/refresh` | `src/app/tools/refresh/actions.ts` | 1 | runRefresh |
| `/tools/render` | `src/app/tools/render/actions.ts` | 1 | runRender |
| `/tools/reputation-abuse-risk` | `src/app/tools/reputation-abuse-risk/actions.ts` | 1 | scanForRisk |
| `/tools/robots-history` | `src/app/tools/robots-history/actions.ts` | 2 | loadSnapshots, runSnapshot |
| `/tools/robots` | `src/app/tools/robots/actions.ts` | 1 | checkRobots |
| `/tools/schema-validate` | `src/app/tools/schema-validate/actions.ts` | 1 | runValidate |
| `/tools/schema` | `src/app/tools/schema/actions.ts` | 1 | generateSchema |
| `/tools/screenshot-import` | `src/app/tools/screenshot-import/actions.ts` | 1 | parseScreenshot |
| `/tools/search-volume` | `src/app/tools/search-volume/actions.ts` | 1 | estimateVolumes |
| `/tools/security` | `src/app/tools/security/actions.ts` | 1 | checkSecurity |
| `/tools/serp-features` | `src/app/tools/serp-features/actions.ts` | 2 | removeSnapshot, runCapture |
| `/tools/sitemap` | `src/app/tools/sitemap/actions.ts` | 1 | generateSitemap |
| `/tools/social-preview` | `src/app/tools/social-preview/actions.ts` | 1 | runSocial |
| `/tools/soft-404` | `src/app/tools/soft-404/actions.ts` | 1 | runSoft404 |
| `/tools/summarizer` | `src/app/tools/summarizer/actions.ts` | 1 | runSummarize |
| `/tools/sxo` | `src/app/tools/sxo/actions.ts` | 1 | runSxoAudit |
| `/tools/traffic-drop` | `src/app/tools/traffic-drop/actions.ts` | 1 | runDiagnostic |
| `/tools/trending` | `src/app/tools/trending/actions.ts` | 1 | runTrending |
| `/tools/uptime` | `src/app/tools/uptime/actions.ts` | 4 | addTarget, deleteTarget, runPingNow, toggleTarget |
| `/tools/utm-attribution` | `src/app/tools/utm-attribution/actions.ts` | 1 | runAttribution |
| `/tools/wayback` | `src/app/tools/wayback/actions.ts` | 1 | runWayback |
| `/tools/wp-hack-scan` | `src/app/tools/wp-hack-scan/actions.ts` | 1 | runWpHackScan |
| `/tools/youtube-audit` | `src/app/tools/youtube-audit/actions.ts` | 1 | runYtAudit |
| `/tools/youtube` | `src/app/tools/youtube/actions.ts` | 3 | clearYouTubeKey, researchOnYouTube, saveYouTubeKey |

## API-area actions

| Route area | File | # | Exported functions |
|---|---|---|---|
| `/api/ai-providers` | `src/app/api/ai-providers/actions.ts` | 1 | listConfiguredProviders |
| `/api/tool-runs` | `src/app/api/tool-runs/actions.ts` | 4 | clearAllRunsForTool, deleteRunAction, fetchRecentRuns, togglePinAction |

