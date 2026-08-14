# Graph Report - social-machine-template  (2026-08-14)

## Corpus Check
- 410 files · ~255,482 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2324 nodes · 5400 edges · 170 communities (111 shown, 59 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c4cc1cad`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Trend Video Safety
- Instagram Giveaway Automation
- Writer Reviewer Agents
- Agent Settings Interface
- Workspace Settings Forms
- Static News Pipeline
- Cross Platform Publishing
- External Engagement Automation
- Brand Asset Generation
- Strategic Agent Insights
- Pipeline Dashboard UI
- Engagement Reply Guardrails
- Social Performance Metrics
- X Platform Client
- Workspace Authentication Onboarding
- Source Evaluation Interface
- AI Video Generation
- Evergreen Settings API
- Instagram Visual Quality
- Article Story Publishing
- Content Quality Guardrails
- Trend Video Dashboard
- Virality Scoring Model
- Adaptive Trend Learning
- Supabase API Routes
- Trend Video Analytics
- Social Platform Adapters
- System Health Reporting
- Agent Registry Execution
- Reel Transcription Recovery
- Telegram Commands Export
- Agent Memory Feedback
- Engagement Deduplication Tests
- SEO Analytics Reporting
- Instagram Publishing Client
- Curator Deduplication Signals
- X Radar Queries
- Telegram Bot Management
- Seasonal Brand Dates
- Trend Topic Refinement
- Trend Creative Templates
- Trend Topic Scoring
- YouTube Content Reader
- Telegram Bot Commands
- PDF Report Export
- Twitter API Integration
- Agent Framework Core
- Google Trends Ingestion
- Storage Cleanup Policy
- Heartbeat Query Guard
- X Trends Ingestion
- RSS Feed Reader
- YouTube Publishing Client
- Brazil Trend Market Fit
- Trend Video Recovery
- Trend Video Operations
- Instagram Reels Reader
- Environment Variables UI
- Privacy Policy Page
- Terms of Service Page
- Agent Fetch Timeout Tests
- EV Reel Preparation
- Branded Social Graphics
- Writer Regression Tests
- Next Sentry Configuration
- Cron Regression Guards
- Publishing Quality Regressions
- Regression Source Guards
- Compile Time Regressions
- Brazilian Trend Discovery
- SEO Strategist Tests
- Trend Creative Preparation
- Engagement Executor Tests
- Next.js Application Layout
- Source Profile Settings
- Reel Publishing Timeouts
- Social OAuth Callbacks
- Supabase Authentication
- Credential Loading Tests
- Curator Author Weighting
- Workspace Scoped Heartbeat Tests
- Reel Preparation Regression
- Data Deletion Page
- Reviewer Weight Tests
- Classname Utility Dependency
- Cron Parser Dependency
- FFmpeg Static Dependency
- Lucide Icons Dependency
- Next.js Framework Dependency
- PDF Generation Dependency
- PDF Parsing Dependency
- React DOM Dependency
- Resend Email Dependency
- Supabase SSR Dependency
- Supabase JavaScript Client
- Tailwind Class Merging
- Vercel Functions Runtime
- Zod Schema Validation
- PostCSS Configuration
- Session Audit Script
- Supabase Database Migrations
- Trend Video Smoke Test
- Telegram Message Queue
- Profile Metrics Snapshots
- Instagram Comment Interactions
- Vercel Ignore Command
- Advertising Campaigns
- Advertising Performance
- Agent Action Log
- Automation Agents
- Curated Content
- Editorial Calendar
- Engagement Actions
- Engagement Profiles
- Evaluation Dataset
- Monitoring Sources
- Performance Snapshots
- Pipeline Runs
- Platform Configuration
- SEO Audits
- SEO Keywords
- Telegram Conversations
- Trending Topics
- Workspace Settings
- Generated Content Table
- Generated Content Table
- Generated Content Table
- Generated Content Table
- Generated Content Table
- TypeScript Configuration
- Runtime Dependencies
- UI Component Configuration
- Development Dependencies
- Brand Asset Pipeline Tests
- Package Runtime Configuration
- Project Scripts
- Evergreen Pillar Tests
- ESLint Configuration
- Content Timestamp Trigger
- Settings Loader Tests
- Public Release Audit
- Document File Icon
- Globe Icon
- Next.js Wordmark
- Vercel Logo
- Browser Window Icon
- AI Trend Research
- Open Source Security
- Instagram Learning System
- Animated Workflow Demo
- Workflow Preview Graphic
- Content Operations Workflow
- Public Template Documentation

## God Nodes (most connected - your core abstractions)
1. `getAdminClient()` - 214 edges
2. `Vitest` - 119 edges
3. `isCronRequest()` - 65 edges
4. `getVariable()` - 60 edges
5. `Next Server` - 60 edges
6. `AgentResult` - 52 edges
7. `RunContext` - 50 edges
8. `cn()` - 49 edges
9. `getNumericVariable()` - 40 edges
10. `generateSimpleText()` - 36 edges

## Surprising Connections (you probably didn't know these)
- `Workspace feature flags for optional capabilities` --semantically_similar_to--> `Optional features disabled by default`  [INFERRED] [semantically similar]
  README.md → CONTRIBUTING.md
- `Brand-neutral public contributions` --semantically_similar_to--> `Optional and brand-neutral design`  [INFERRED] [semantically similar]
  CONTRIBUTING.md → .github/ISSUE_TEMPLATE/feature_request.yml
- `workflow_showcase classifier category` --conceptually_related_to--> `Discover, curate, create, review, publish, and learn loop`  [INFERRED]
  docs/RADAR_IA_APLICADORES.md → README.md
- `Public-release audit` --conceptually_related_to--> `Social Machine security policy`  [INFERRED]
  .github/workflows/ci.yml → SECURITY.md
- `Social Machine security policy` --conceptually_related_to--> `Credential and customer-data redaction`  [INFERRED]
  SECURITY.md → .github/ISSUE_TEMPLATE/bug_report.yml

## Import Cycles
- 1-file cycle: `next.config.regression.test.ts -> next.config.regression.test.ts`
- 1-file cycle: `src/lib/video/stitch-trend-video.ts -> src/lib/video/stitch-trend-video.ts`
- 1-file cycle: `src/app/api/cron/reels-prepare/prompt-structure.regression.test.ts -> src/app/api/cron/reels-prepare/prompt-structure.regression.test.ts`
- 1-file cycle: `src/lib/agents/publisher/final-quality-feedback.regression.test.ts -> src/lib/agents/publisher/final-quality-feedback.regression.test.ts`
- 1-file cycle: `src/app/api/agents/[slug]/run/route.ts -> src/app/api/agents/[slug]/run/route.ts`
- 1-file cycle: `src/lib/ai/generate-with-fallback.ts -> src/lib/ai/generate-with-fallback.ts`
- 1-file cycle: `src/lib/agents/ads-strategist/index.ts -> src/lib/agents/ads-strategist/index.ts`
- 1-file cycle: `next.config.ts -> next.config.ts`
- 1-file cycle: `src/app/(dashboard)/settings/agents/page.tsx -> src/app/(dashboard)/settings/agents/page.tsx`
- 1-file cycle: `src/components/ui/button.tsx -> src/components/ui/button.tsx`
- 1-file cycle: `src/components/ui/select.tsx -> src/components/ui/select.tsx`
- 1-file cycle: `src/components/ui/separator.tsx -> src/components/ui/separator.tsx`
- 1-file cycle: `src/components/ui/badge.tsx -> src/components/ui/badge.tsx`
- 1-file cycle: `src/components/ui/input.tsx -> src/components/ui/input.tsx`
- 1-file cycle: `src/components/ui/switch.tsx -> src/components/ui/switch.tsx`
- 1-file cycle: `src/app/(dashboard)/agents/[slug]/page.tsx -> src/app/(dashboard)/agents/[slug]/page.tsx`
- 1-file cycle: `src/lib/utils.ts -> src/lib/utils.ts`
- 1-file cycle: `src/components/ui/tabs.tsx -> src/components/ui/tabs.tsx`
- 1-file cycle: `src/app/api/og/brand-asset-frame/route.tsx -> src/app/api/og/brand-asset-frame/route.tsx`
- 1-file cycle: `src/lib/pipeline/brand-static-visual.ts -> src/lib/pipeline/brand-static-visual.ts`

## Hyperedges (group relationships)
- **Instagram Learning Layers** — docs_instagram_autolearning_playbook_reel_metrics_capture, docs_instagram_autolearning_playbook_writer_reach_feedback, docs_instagram_autolearning_playbook_weighted_reviewer_scoring, docs_instagram_autolearning_playbook_curator_author_feedback, docs_instagram_autolearning_playbook_comment_autoreply [EXTRACTED 1.00]
- **Radar Processing System** — docs_radar_ia_knowledge_tiered_polling_strategy, docs_radar_ia_knowledge_tweet_classifier, docs_radar_ia_knowledge_embedding_dedup_clusters, docs_radar_ia_knowledge_newsletter_cluster_pipeline [EXTRACTED 1.00]
- **Trend Pipeline Control Surface** — docs_trend_video_mvp_cron_pipeline_endpoints, docs_trend_video_mvp_panel_configuration, docs_trend_video_mvp_manual_test_sequence, docs_trend_video_mvp_job_lifecycle_states [EXTRACTED 1.00]

## Communities (170 total, 59 thin omitted)

### Community 0 - "Trend Video Safety"
Cohesion: 0.05
Nodes (50): TrendSafetyResult, JsonObject, TrendVideoQualityResult, TrendVideoVisualQaMetrics, TrendVideoVisualQaResult, evaluateTrendSafety(), asObject(), collectSegments() (+42 more)

### Community 1 - "Instagram Giveaway Automation"
Cohesion: 0.06
Nodes (53): MediaContext, GiveawayLeadRow, WorkspaceRow, TrendGiveawayContext, IgComment, IgMessage, BuildTrendGiveawayInput, GiveawayShot (+45 more)

### Community 10 - "Writer Reviewer Agents"
Cohesion: 0.07
Nodes (32): ActionStatus, AgentDbConfig, EvalVerdict, PipelineRunStatus, PipelineStage, PipelineTrigger, CriticalChecks, DraftItem (+24 more)

### Community 13 - "Agent Settings Interface"
Cohesion: 0.08
Nodes (30): AgentConfig, AgentStatus, AgentsSettingsPage(), SettingsNav(), CardAction(), CardDescription(), CardFooter(), SelectContent() (+22 more)

### Community 15 - "Workspace Settings Forms"
Cohesion: 0.15
Nodes (23): BrandConfig, WorkspaceData, Setting, Setting, QualitySetting, WorkspaceSettingsPage(), QualitySettingsPage(), OnboardingPage() (+15 more)

### Community 16 - "Static News Pipeline"
Cohesion: 0.10
Nodes (35): brandBrazilLaunchCategory, brandBrazilLaunchResult, StaticNewsB2BAngle, StaticNewsCandidate, StaticNewsCandidateInput, StaticNewsDraft, StaticNewsMediaMode, StaticNewsQueueItem (+27 more)

### Community 17 - "Cross Platform Publishing"
Cohesion: 0.11
Nodes (29): PublishEntry, CredentialSet, PlatformCredentials, burnSubtitlesForX(), finalizeExceptionRetry(), generateReelCover(), generateSlideImage(), getSourceMedia() (+21 more)

### Community 18 - "External Engagement Automation"
Cohesion: 0.10
Nodes (27): CommentStyle, EngagementExternalAgent, GeneratedComment, extractTweetId(), GET(), isQuietHours(), mergeMetadata(), parseHandleList() (+19 more)

### Community 19 - "Brand Asset Generation"
Cohesion: 0.13
Nodes (25): BrandLogo, CarouselSlide, CuratedCarouselSlide, MarketingAssetRow, publishContent(), buildStoryQueuePatch(), buildLogoUrl(), detectBrand() (+17 more)

### Community 2 - "Strategic Agent Insights"
Cohesion: 0.06
Nodes (40): AdCampaign, AdPerformanceRow, AdPlatform, AnalysisResult, CampaignStatus, OptimizationInsight, KeywordData, CalendarEntry (+32 more)

### Community 20 - "Pipeline Dashboard UI"
Cohesion: 0.12
Nodes (29): ContentItem, rejectContent(), AgentsPage(), relativeTime(), DashboardPage(), formatDuration(), relativeTime(), Sparkline() (+21 more)

### Community 21 - "Engagement Reply Guardrails"
Cohesion: 0.10
Nodes (30): GeneratedReply, GuardrailMetadata, RecentGuardrailAction, ReplyStyle, SuppressedReply, GuardrailAction, GuardrailDecision, GuardrailHistoryAction (+22 more)

### Community 23 - "Social Performance Metrics"
Cohesion: 0.14
Nodes (21): GeneratedContentRow, GiveawayLeadRow, SnapshotRow, TopicRow, TrendVideoJobRow, ReelEngagement, TablesUpdate, GET() (+13 more)

### Community 24 - "X Platform Client"
Cohesion: 0.15
Nodes (13): XClient, XCredentials, XMedia, XSearchTweet, XSearchUser, buildOAuthHeader(), fetchWithRetry(), fetchWithTimeout() (+5 more)

### Community 25 - "Workspace Authentication Onboarding"
Cohesion: 0.11
Nodes (21): Workspace, switchWorkspace(), POST(), POST(), slugify(), AgentDetailPage(), relativeTime(), sparklinePath() (+13 more)

### Community 29 - "Source Evaluation Interface"
Cohesion: 0.10
Nodes (15): EvalRow, EngagementProfile, MonitorSource, TrendingConfig, TrendVideoConfig, EvaluationsPage(), KeywordsTab(), TrendingTab() (+7 more)

### Community 3 - "AI Video Generation"
Cohesion: 0.07
Nodes (54): JsonObject, ShotStatus, TrendShotResult, TrendImageGenerationResult, HiggsfieldConfig, HiggsfieldJobResult, HiggsfieldTextToVideoStartInput, ImageGenerationAttempt (+46 more)

### Community 30 - "Evergreen Settings API"
Cohesion: 0.14
Nodes (20): Pillar, VariableDefinition, WorkspaceSettings, GET(), GET(), PUT(), GET(), isSuperAdmin() (+12 more)

### Community 31 - "Instagram Visual Quality"
Cohesion: 0.10
Nodes (18): GeminiPart, InstagramVisualQualityResult, InstagramVisualQualityScores, ScoreDimension, VisualAsset, CarouselItem, InstagramCredentials, loadImageParts() (+10 more)

### Community 32 - "Article Story Publishing"
Cohesion: 0.13
Nodes (18): CuratedStaticSlide, ArticleResult, POST(), GET(), GET(), normalizeDraft(), buildStoryMediaPayload(), GET() (+10 more)

### Community 33 - "Content Quality Guardrails"
Cohesion: 0.15
Nodes (18): QualityCheckResult, StructuredPost, PlatformConfig, applyGuardrails(), checkGuardrails(), checkGuardrailsSync(), loadPatterns(), getPublishableContentText() (+10 more)

### Community 34 - "Trend Video Dashboard"
Cohesion: 0.14
Nodes (22): GeneratedContentLiteRow, JobStatus, JsonObject, StyleStatRow, TopicRow, TrendVideoJobRow, asJsonObject(), countByStatus() (+14 more)

### Community 36 - "Virality Scoring Model"
Cohesion: 0.13
Nodes (21): ViralityInput, ViralityResult, calcAuthorAuthority(), calcCascadePotential(), calcContentRelevance(), calcContentTypeSignal(), calcEngagementQuality(), calcEngagementVelocity() (+13 more)

### Community 39 - "Adaptive Trend Learning"
Cohesion: 0.18
Nodes (19): JsonObject, AdaptiveTrendTopicInput, TrendHistoricalDecisionLike, TrendLearningPack, TrendLearningPreference, TrendStyleStatLike, TrendVideoLearningPreference, asRecord() (+11 more)

### Community 4 - "Supabase API Routes"
Cohesion: 0.08
Nodes (43): Category, RouteParams, CompositeTypes, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Tables (+35 more)

### Community 40 - "Trend Video Analytics"
Cohesion: 0.15
Nodes (17): InstagramMediaInsightsResult, GiveawayFunnelSummary, ProfileMetricsSnapshotLike, TrendAnalyticsRowInput, TrendGiveawayLeadLike, TrendNormalizedMetrics, GET(), loadFollowerSnapshots() (+9 more)

### Community 41 - "Social Platform Adapters"
Cohesion: 0.13
Nodes (5): LinkedInClient, LinkedInCredentials, PlatformAdapter, PlatformPost, SearchOptions

### Community 42 - "System Health Reporting"
Cohesion: 0.17
Nodes (13): ReportEmailLabel, GET(), GET(), isOpenAiQuotaExceeded(), clean(), getResend(), markdownToHtml(), sendReportEmail() (+5 more)

### Community 43 - "Agent Registry Execution"
Cohesion: 0.15
Nodes (10): RouteParams, AgentRegistry, RunOptions, AgentSlug, POST(), POST(), maxDuration, maxDuration (+2 more)

### Community 44 - "Reel Transcription Recovery"
Cohesion: 0.15
Nodes (11): TranscriptResult, GET(), parseSrtToFrames(), _run(), sendFirstImageNotificationEmail(), pickFollowCtaAngle(), transcribeVideo(), maxDuration (+3 more)

### Community 46 - "Telegram Commands Export"
Cohesion: 0.18
Nodes (13): RouteParams, TableBlock, ProcessedMedia, POST(), isTelegramWebhook(), executeCommand(), parseCommand(), downloadTelegramFile() (+5 more)

### Community 47 - "Agent Memory Feedback"
Cohesion: 0.18
Nodes (14): RateLimitCheck, BrandContext, FeedbackBlock, AgentMemory, runAgent(), sendTelegramMessage(), checkRateLimit(), buildBrandContext() (+6 more)

### Community 49 - "Engagement Deduplication Tests"
Cohesion: 0.11
Nodes (12): CountResult, MockChain, UpdateResult, insertedTargetUrls, THIRD_PARTY_REPLY, mockCount, mockedGenerateSimpleText, mockedGetVariable (+4 more)

### Community 50 - "SEO Analytics Reporting"
Cohesion: 0.22
Nodes (10): SeoStrategistAgent, AnalyticsReport, SearchConsoleReport, querySearchConsole(), runGA4Report(), getGoogleAccessToken(), isGoogleConfigured(), resolveGoogleOAuthConfig() (+2 more)

### Community 51 - "Instagram Publishing Client"
Cohesion: 0.26
Nodes (3): InstagramClient, PublishResult, getRandomUA()

### Community 53 - "Curator Deduplication Signals"
Cohesion: 0.18
Nodes (10): TweetSearchResult, extractKeywordFingerprint(), findDuplicate(), fingerprintSimilarity(), isDuplicateCuratedContent(), searchTweets(), agent, BRAND_REEL_KEYWORDS (+2 more)

### Community 54 - "X Radar Queries"
Cohesion: 0.13
Nodes (14): RadarQuery, isCompetitorAccount(), isTopicRelevant(), CURATOR_SRC, RADAR_QUERIES_SRC, RADAR_SRC, RSS_SRC, __testdir (+6 more)

### Community 56 - "Telegram Bot Management"
Cohesion: 0.16
Nodes (5): BotClient, BotManager, sendMessage(), sendLongMessage(), splitText()

### Community 57 - "Seasonal Brand Dates"
Cohesion: 0.20
Nodes (12): SeasonalDateRow, computeEasterSunday(), evCategoryFocusSeasonal(), isSameUTCDate(), resolveOccurrenceDate(), runSeasonalBrand(), curatedContentInserts, lastUsedYearUpdates (+4 more)

### Community 59 - "Trend Topic Refinement"
Cohesion: 0.27
Nodes (12): RelatedNewsItem, normalizeTrendTopic(), cleanCandidate(), extractCandidates(), getTopicFamily(), isGenericAiTopic(), refineTrendTopic(), scoreCandidate() (+4 more)

### Community 6 - "Trend Creative Templates"
Cohesion: 0.08
Nodes (49): ShotBlueprint, ShotStyleSpec, StyleBucket, TrendCreativeLearningInput, TrendEditorialPack, TrendVideoMotionPack, TrendVideoShot, TrendEditorialTemplate (+41 more)

### Community 60 - "Trend Topic Scoring"
Cohesion: 0.29
Nodes (12): TrendScoreBreakdown, TrendScoreResult, TrendScoringInput, clamp(), scoreControversyPenalty(), scoreEmotionalPotential(), scoreFreshness(), scoreShortViralFit() (+4 more)

### Community 62 - "YouTube Content Reader"
Cohesion: 0.29
Nodes (10): YouTubeVideoItem, YouTubeVideoStatistics, YTSearchItem, getApiKey(), getChannelLatestVideos(), getOAuthToken(), getVideoStatistics(), mapItem() (+2 more)

### Community 63 - "Telegram Bot Commands"
Cohesion: 0.15
Nodes (11): CommandContext, CommandHandler, handleArticle(), handlePause(), handlePipeline(), handleReport(), handleResume(), handleRun() (+3 more)

### Community 68 - "PDF Report Export"
Cohesion: 0.29
Nodes (10): Section, cleanText(), generateReportPDF(), checkPage(), newPage(), isSeparatorRow(), parseMarkdown(), parseTableRow() (+2 more)

### Community 69 - "Twitter API Integration"
Cohesion: 0.25
Nodes (9): SearchResponse, TwitterApiIoMedia, TwitterApiIoSearchResult, TwitterApiIoTweet, extractMediaFromIoTweet(), getTrendingIO(), getUserTimelineIO(), searchTwitterApiIo() (+1 more)

### Community 7 - "Agent Framework Core"
Cohesion: 0.08
Nodes (17): AdsStrategistAgent, AgentConfig, AgentResult, EvalEntry, RunContext, BaseAgent, CuratorAgent, EditorInChiefAgent (+9 more)

### Community 70 - "Google Trends Ingestion"
Cohesion: 0.31
Nodes (9): GoogleTrendTopic, TrendNewsItem, classifyTopic(), decodeXml(), extractBlocks(), extractTag(), fetchGoogleTrendsRss(), parseGoogleTrendsRss() (+1 more)

### Community 76 - "Storage Cleanup Policy"
Cohesion: 0.40
Nodes (7): CleanupTarget, GET(), isExpired(), listAllFiles(), maxDuration, CLEANUP_TARGETS, PROTECTED_FOLDERS

### Community 81 - "Heartbeat Query Guard"
Cohesion: 0.36
Nodes (7): DbErrorCollector, PgError, createDbErrorCollector(), guardCount(), guardData(), record(), routeSrc

### Community 82 - "X Trends Ingestion"
Cohesion: 0.33
Nodes (6): XTrendTopic, classifyTopic(), countryCodeToWoeid(), fetchXTrendingTopics(), formatTweetCount(), getTrending

### Community 83 - "RSS Feed Reader"
Cohesion: 0.43
Nodes (7): RssItem, extractTag(), fetchRssFeed(), parseDate(), parseFeed(), stripCdata(), stripHtml()

### Community 84 - "YouTube Publishing Client"
Cohesion: 0.29
Nodes (3): YouTubeClient, YouTubeCredentials, YouTubePublishResult

### Community 87 - "Brazil Trend Market Fit"
Cohesion: 0.38
Nodes (5): RelatedNewsItem, countMatches(), scoreTrendBrazilAiFit(), BRAZILIAN_SOURCE_KEYWORDS, STRONG_AI_KEYWORDS

### Community 88 - "Trend Video Recovery"
Cohesion: 0.38
Nodes (5): RawSegment, RawShot, RecoverableSegment, recoverTrendVideoSegments(), toSegment()

### Community 9 - "Trend Video Operations"
Cohesion: 0.09
Nodes (41): TrendVideoBottleneckCopy, TrendVideoBottleneckKey, TrendVideoOperationalStage, TrendVideoOpsObservabilityConfig, TrendVideoOpsBottleneck, TrendVideoOpsJobLike, TrendVideoOpsJobStatus, TrendVideoOpsSummary (+33 more)

### Community 92 - "Instagram Reels Reader"
Cohesion: 0.40
Nodes (4): IGDiscoveryResponse, IGMediaNode, IGReelItem, getInstagramAccountReels()

### Community 11 - "EV Reel Preparation"
Cohesion: 0.13
Nodes (33): GET(), brandImageFallback(), buildbrandAiPrompt(), buildDallePrompt(), parseSrtToFrames(), sortBrazilFirst(), GET(), aiSentinelCode() (+25 more)

### Community 14 - "Branded Social Graphics"
Cohesion: 0.07
Nodes (29): GET(), headlineSize(), GET(), hookSize(), GET(), headlineSize(), cleanTitle(), GET() (+21 more)

### Community 22 - "Writer Regression Tests"
Cohesion: 0.06
Nodes (26): makeChain(), setCuratedItem(), makeChain(), setCuratedItem(), makeChain(), setCuratedItem(), agent, BASE_ITEM (+18 more)

### Community 28 - "Next Sentry Configuration"
Cohesion: 0.12
Nodes (18): GET(), generateEditorialCover(), GET(), GET(), GET(), isEnabled(), parseCsv(), register() (+10 more)

### Community 38 - "Cron Regression Guards"
Cohesion: 0.10
Nodes (11): assertAllFetchesHaveTimeout(), findFetchCallSpans(), fmt(), subtitlesToCapcutAss(), CRON_DIR, FILE, src, SRC (+3 more)

### Community 45 - "Publishing Quality Regressions"
Cohesion: 0.11
Nodes (11): MARKETING, PUBLISHER, TREND, mockFetch, mockGenerateTextWithFallback, REEL_RENDERER_ENV, SRC, SRC (+3 more)

### Community 5 - "Regression Source Guards"
Cohesion: 0.05
Nodes (29): assertAllFetchesHaveTimeout(), findFetchCallSpans(), SRC, SRC, SRC, PUBLISH_CONTAINER_SRC, ROUTE_SRC, SETTINGS_SRC (+21 more)

### Community 52 - "Compile Time Regressions"
Cohesion: 0.12
Nodes (12): compileTimeTraps(), CAROUSEL, mockFetch, POST_IMAGE, REEL_COVER, __testdir, mockFetch, REEL_ROUTE (+4 more)

### Community 55 - "Brazilian Trend Discovery"
Cohesion: 0.23
Nodes (11): asRecord(), GET(), isEnabled(), parseCsv(), toNumber(), matchesTrendFocus(), parseCsv(), containsAiSeed() (+3 more)

### Community 58 - "SEO Strategist Tests"
Cohesion: 0.14
Nodes (10): mockExecuteToolLoop, mockFetch, mockGenerateSimpleText, mockInsert, mockKeywordsChain, mockMaybeSingle, mockParseAIJson, mockSendLongMessage (+2 more)

### Community 64 - "Trend Creative Preparation"
Cohesion: 0.30
Nodes (10): asRecord(), GET(), isEnabled(), parseCsv(), toNumber(), applyLearnedStyleRotation(), supportsTrendVideoGenerationMemory(), withOptionalTrendVideoGenerationMemory() (+2 more)

### Community 65 - "Engagement Executor Tests"
Cohesion: 0.17
Nodes (6): mockActions, mockLike, mockReply, mockRetweet, mockUpdate, NOON_UTC

### Community 74 - "Next.js Application Layout"
Cohesion: 0.20
Nodes (7): nextConfig, geistMono, geistSans, metadata, Next, Next Font Google, Src App Globals

### Community 77 - "Source Profile Settings"
Cohesion: 0.22
Nodes (4): EngagementProfilesTab(), addProfile(), toggleActive(), ProfilesTab()

### Community 78 - "Reel Publishing Timeouts"
Cohesion: 0.20
Nodes (6): AGENT_RUN_SRC, brand_COVER_SRC, IG_CLIENT_SRC, OPENAI_IMAGE_SRC, PUBLISH_REEL_SRC, PUBLISHER_SRC

### Community 80 - "Social OAuth Callbacks"
Cohesion: 0.39
Nodes (7): GET(), getBaseUrl(), renderPage(), GET(), getBaseUrl(), renderPage(), invalidateCredentialsCache()

### Community 85 - "Supabase Authentication"
Cohesion: 0.29
Nodes (4): LoginPage(), createClient(), config, Supabase Ssr

### Community 86 - "Credential Loading Tests"
Cohesion: 0.29
Nodes (5): loadModule(), mockEq, mockFrom, mockSelect, mockSingle

### Community 91 - "Curator Author Weighting"
Cohesion: 0.70
Nodes (3): buildAuthorReachWeights(), computeAuthorWeight(), median()

### Community 12 - "Supabase Database Migrations"
Cohesion: 0.07
Nodes (26): auth, auth.users, workspaces, agent_actions, agents, pipeline_runs, curated_content, generated_content (+18 more)

### Community 27 - "TypeScript Configuration"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 35 - "Runtime Dependencies"
Cohesion: 0.09
Nodes (23): dependencies, ai, @ai-sdk/anthropic, @ai-sdk/deepseek, @ai-sdk/google, @base-ui/react, class-variance-authority, @openrouter/ai-sdk-provider (+15 more)

### Community 37 - "UI Component Configuration"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 48 - "Development Dependencies"
Cohesion: 0.11
Nodes (19): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom (+11 more)

### Community 66 - "Brand Asset Pipeline Tests"
Cohesion: 0.17
Nodes (11): assetUpdates, BASE_ASSET, generatedContentInserts, generatedContentUpdates, isFilterCalls, mockBuildStoryQueuePatch, mockFromFn, mockGetInstagramCredentials (+3 more)

### Community 75 - "Package Runtime Configuration"
Cohesion: 0.20
Nodes (9): engines, node, npm, name, overrides, postcss, sharp, private (+1 more)

### Community 79 - "Project Scripts"
Cohesion: 0.22
Nodes (9): scripts, audit:public-release, build, dev, lint, session-audit, start, test (+1 more)

### Community 89 - "Evergreen Pillar Tests"
Cohesion: 0.33
Nodes (5): factUpdates, mockFacts, mockFrom, mockGetVariable, mockUpdateSetting

### Community 90 - "ESLint Configuration"
Cohesion: 0.40
Nodes (4): eslintConfig, Eslint Config, Eslint Config Next Core Web Vitals, Eslint Config Next Typescript

### Community 96 - "Settings Loader Tests"
Cohesion: 0.50
Nodes (3): mockEq, mockFrom, mockSelect

### Community 26 - "AI Trend Research"
Cohesion: 0.07
Nodes (30): Classification and Dedup Pipeline, Editorial Curator Dashboard, Refined Newsletter Scoring, Ten Primary Source Tiers, Tiered Ingestion Worker, Early Viral Acceleration, Embedding Deduplication Clusters, Global AI Breaking News Radar (+22 more)

### Community 61 - "Open Source Security"
Cohesion: 0.18
Nodes (13): Clean Deployment Acceptance, Generic Mechanisms Preserved, Sensitive Operation Removal, Public Release Safeguards, Audit Test Build Validation, Workspace Ownership Checks, Open Source Publication Plan, Security Review July 2026 (+5 more)

### Community 67 - "Instagram Learning System"
Cohesion: 0.18
Nodes (11): Instagram Comment Autoreply, Continuous Content Learning Loop, Curator Author Feedback, Meta Webhook Routing, Reel Metrics Capture, Profile Replication Checklist, Weighted Reviewer Scoring, Workspace Profile Configuration (+3 more)

### Community 71 - "Animated Workflow Demo"
Cohesion: 0.27
Nodes (10): Animated progress from signal through curation, drafting, approval, and publication, Animated navigation across pipeline, drafts, and evaluation views, Approval followed by publication and performance learning, Checked duplicates, Visible counts for discovered, curated, in-review, approved, and published items, Recorded human decision, Retained source, Scored quality (+2 more)

### Community 72 - "Workflow Preview Graphic"
Cohesion: 0.24
Nodes (10): Relevant source transformed into a reviewable channel-ready draft, Single workspace with clear stages and controlled publishing, Duplicate checking, Human decision recording, Learning from published-content performance, Pipeline counts for discovered, curated, in-review, approved, and published content, Quality scoring, Signal-to-publication content pipeline (+2 more)

### Community 73 - "Content Operations Workflow"
Cohesion: 0.29
Nodes (10): Create drafts shaped by editorial rules, Rank relevance and remove duplicates, Discover trends and sources, Quality gates and human approval, Optional AI and publishing integrations, Measure results and improve the next run, Self-hosted data, Unified content workflow operating as one system (+2 more)

### Community 8 - "Public Template Documentation"
Cohesion: 0.05
Nodes (48): Public template quality workflow, Reusable optional platform adapters, Layer 18 workflow-builder taxonomy, Media and multi-tool scoring boosts, Practical AI adoption signal, Automation, media, agent, and vertical tool vocabulary, Source weights and polling cadence, Workflow applicator profile criteria (+40 more)

## Knowledge Gaps
- **670 isolated node(s):** `TrendSafetyResult`, `JsonObject`, `TrendVideoQualityResult`, `TrendVideoVisualQaMetrics`, `TrendVideoVisualQaResult` (+665 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **59 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getAdminClient()` connect `Supabase API Routes` to `Trend Video Safety`, `Instagram Giveaway Automation`, `Strategic Agent Insights`, `AI Video Generation`, `Agent Framework Core`, `Trend Video Operations`, `Writer Reviewer Agents`, `EV Reel Preparation`, `Cross Platform Publishing`, `External Engagement Automation`, `Brand Asset Generation`, `Pipeline Dashboard UI`, `Engagement Reply Guardrails`, `Social Performance Metrics`, `Workspace Authentication Onboarding`, `Next Sentry Configuration`, `Source Evaluation Interface`, `Evergreen Settings API`, `Article Story Publishing`, `Content Quality Guardrails`, `Trend Video Dashboard`, `Adaptive Trend Learning`, `Trend Video Analytics`, `System Health Reporting`, `Agent Registry Execution`, `Reel Transcription Recovery`, `Telegram Commands Export`, `Agent Memory Feedback`, `SEO Analytics Reporting`, `Compile Time Regressions`, `Curator Deduplication Signals`, `X Radar Queries`, `Brazilian Trend Discovery`, `Telegram Bot Management`, `Seasonal Brand Dates`, `Telegram Bot Commands`, `Trend Creative Preparation`, `Storage Cleanup Policy`, `Social OAuth Callbacks`, `Curator Author Weighting`?**
  _High betweenness centrality (0.214) - this node is a cross-community bridge._
- **Why does `Vitest` connect `Cron Regression Guards` to `Trend Video Safety`, `Instagram Giveaway Automation`, `Strategic Agent Insights`, `AI Video Generation`, `Supabase API Routes`, `Regression Source Guards`, `Trend Creative Templates`, `Trend Video Operations`, `Writer Reviewer Agents`, `EV Reel Preparation`, `Branded Social Graphics`, `Static News Pipeline`, `Cross Platform Publishing`, `External Engagement Automation`, `Brand Asset Generation`, `Engagement Reply Guardrails`, `Writer Regression Tests`, `Social Performance Metrics`, `Evergreen Settings API`, `Instagram Visual Quality`, `Article Story Publishing`, `Content Quality Guardrails`, `Adaptive Trend Learning`, `Trend Video Analytics`, `System Health Reporting`, `Reel Transcription Recovery`, `Publishing Quality Regressions`, `Engagement Deduplication Tests`, `Compile Time Regressions`, `Curator Deduplication Signals`, `X Radar Queries`, `Brazilian Trend Discovery`, `Seasonal Brand Dates`, `SEO Strategist Tests`, `Trend Topic Refinement`, `Trend Topic Scoring`, `YouTube Content Reader`, `Engagement Executor Tests`, `Brand Asset Pipeline Tests`, `Twitter API Integration`, `Google Trends Ingestion`, `Storage Cleanup Policy`, `Reel Publishing Timeouts`, `Heartbeat Query Guard`, `X Trends Ingestion`, `Credential Loading Tests`, `Brazil Trend Market Fit`, `Trend Video Recovery`, `Evergreen Pillar Tests`, `Curator Author Weighting`, `Workspace Scoped Heartbeat Tests`, `Settings Loader Tests`, `Reel Preparation Regression`, `Agent Fetch Timeout Tests`, `Reviewer Weight Tests`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._
- **Why does `Next Server` connect `Supabase API Routes` to `Instagram Giveaway Automation`, `AI Video Generation`, `Trend Video Operations`, `EV Reel Preparation`, `Branded Social Graphics`, `External Engagement Automation`, `Social Performance Metrics`, `Workspace Authentication Onboarding`, `Next Sentry Configuration`, `Evergreen Settings API`, `Article Story Publishing`, `Adaptive Trend Learning`, `System Health Reporting`, `Agent Registry Execution`, `Reel Transcription Recovery`, `Telegram Commands Export`, `Brazilian Trend Discovery`, `Trend Creative Preparation`, `Storage Cleanup Policy`, `Social OAuth Callbacks`, `Supabase Authentication`, `Reel Preparation Regression`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `getVariable()` (e.g. with `engagement-external.test.ts` and `engagement-own.test.ts`) actually correct?**
  _`getVariable()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `TrendSafetyResult`, `JsonObject`, `TrendVideoQualityResult` to the rest of the system?**
  _670 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Trend Video Safety` be split into smaller, more focused modules?**
  _Cohesion score 0.05325140809011777 - nodes in this community are weakly interconnected._
- **Should `Instagram Giveaway Automation` be split into smaller, more focused modules?**
  _Cohesion score 0.06349206349206349 - nodes in this community are weakly interconnected._