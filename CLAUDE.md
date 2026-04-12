# CodeReviewer — Harness Engineering Optimization Plan

This document is the living plan for bringing CodeReviewer's LLM infrastructure up to modern harness engineering standards. It is organized into priority tiers (P0 → P3) with concrete deliverables. Each item has an owner, scope, files, and acceptance criteria.

**Positioning principle**: the project's *methodology* (multi-role debate, MREP grounding, grounded-judge, self-evolution loop) is already a moat. The *infrastructure* layer is what we need to upgrade. Do not rewrite the methodology; wrap it with better plumbing.

---

## Progress overview

| Tier | Theme | Status | Validated |
|---|---|---|---|
| **P0** | Stop the bleeding | ✅ **Done** (5/5) | DDT-Monodt local + SG ECS Claude |
| **P1** | Core reliability | ✅ **3/4 Done** (P1-1 remaining) | DDT-Monodt local + SG ECS Claude |
| **P2** | Capability jump | ⏳ Not started | — |
| **P3** | Productionization | ⏳ Not started | — |
| **Deploy** | Alibaba Cloud SG ECS | ✅ **Done** | Claude API from SG verified |

### Key metrics from DDT-Monodt production test (2026-04-12)

| Metric | DeepSeek (local) | Claude Sonnet (SG ECS) |
|---|---|---|
| Provider routing | ✅ | ✅ |
| Prompt caching | cache_read=8768 (38.6% hit) | **~97% hit** (roles 2-4: 35 input tokens each) |
| Context filter savings | boss -59%, skeptic -48%, trade_expert -43% | boss -77%, trade_expert -68%, skeptic -58% |
| Trace spans | 33, 0 open | 33, 0 open |
| Judge score | overall=80 | overall=76 |
| Total eval time | 609s | 756s |
| Tests passing | 87/87 | — |

---

## P0 — Stop the bleeding ✅ DONE

### P0-1 · Deterministic judgment ✅
**Commit**: `39f620a`
- `callQwen` accepts optional `temperature` parameter (backward-compatible default `0.7`)
- `judge.ts:66` and `reference-builder.ts:194` pass `temperature: 0`
- `role-evolution.ts` reflection/synthesis use `temperature: 0.3`

### P0-2 · Refresh Claude model IDs ✅
**Commit**: `39f620a`
- Updated to `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`

### P0-3 · Centralized AI client ✅
**Commit**: `39f620a`
- `server/src/ai/client.ts` — single entry point with retry+backoff, timeout, usage tracking
- Provider routing: `deepseek` / `claude` / `openai`, auto-detected from env vars
- `selectProvider()` supports explicit override, `AI_PROVIDER` env var, or key-based auto-detect
- Usage aggregator keyed by `(evaluationId, callSite)`, exposed via `GET /api/usage/:evaluationId`

### P0-4 · Prompt caching for Claude ✅
**Commit**: `39f620a`
- `ContentPart` type: messages can carry `cacheable: true` hint
- `buildClaudeRequest()` translates `cacheable: true` → `cache_control: { type: 'ephemeral' }`
- `evaluateWithRole()` splits user message into cacheable prefix (project analysis) + variable suffix
- Non-Claude providers flatten content parts to plain string (transparent)
- **Production verified**: Claude roles 2-4 get 35 input tokens (97% cache hit)

### P0-5 · Official SDKs ✅
**Commit**: `39f620a`
- `@anthropic-ai/sdk` for Claude path (typed errors, cache_control support)
- `openai` for OpenAI path (automatic cached_tokens reporting)
- DeepSeek stays on hand-rolled HTTP (OpenAI-compatible but non-standard base URL)

---

## P1 — Core reliability (3/4 done)

### P1-1 · Structured output via tool-use ⏳ TODO
**Problem**: every role call asks "请确保返回合法的 JSON 格式", then `try/catch` parses. Failures force full retries.

**Deliverable**:
- Define a zod schema per role output in `server/src/ai/schemas/`
- Switch role calls to tool-use / function-calling where the provider supports it (Claude, OpenAI)
- For DeepSeek, fall back to JSON mode + zod validation with one focused retry that feeds the parse error back
- On failure, salvage partial output rather than throwing the whole role away

**Acceptance**: JSON parse success rate ≥98% on a 50-project regression set.

### P1-2 · Per-role context filtering ✅
**Commit**: `a88e8ce`
- `server/src/ai/context-filter.ts` — section-tag system splits analysis by `##` headers
- 10 section tags: core, api, database, metrics, engineering, testing, docs, architecture, specs, samples
- Per-role tag sets: architect gets everything, boss/growth/pricing get core+docs only, trade_expert gets api+db+specs+architecture
- Unknown roles fall through to full analysis (safe default)
- **Production verified**: boss saves 59-77%, trade_expert saves 43-68%

### P1-3 · Trace / span observability ✅
**Commit**: `a88e8ce`
- `server/src/observability/tracer.ts` — AsyncLocalStorage-based span tree
- `withTrace()` / `withSpan()` / `setSpanAttributes()` — zero-config nesting
- `chat()` in client.ts auto-creates `llm:<provider>` child spans with token/cache attributes
- `runEvaluation` wraps phases: analyze → role:* → debate → orchestrate
- Phase 3 (reflection/judge/prescription) correctly awaited inside trace scope
- Traces persisted to `data/traces/<evaluationId>.json`
- `GET /api/trace/:evaluationId` returns full trace tree
- **Production verified**: 33 spans, 0 open, all timings correct

### P1-4 · Prompt injection defense ✅
**Commit**: `e3ece70`
- `server/src/ai/prompt-safety.ts` — `wrapUserContext()` + `withSafetyFooter()`
- User-controlled `context` wrapped in `<user_context>` boundary tags
- Pre-existing `<user_context>` tags neutralized (case/whitespace tolerant)
- Safety footer appended to all role + orchestrator + debate system prompts
- 15-payload injection corpus test suite (29 tests total)

---

## P2 — Capability jump (not started)

### P2-1 · Agent loop: let roles read code on demand
**Problem**: roles today eat a static analysis dump. FactChecker and Coder cannot actually look at the file they're discussing.

**Deliverable**: `server/src/ai/agent-loop.ts` — bounded ReAct-style loop with tools: `read_file`, `search_code`, `list_directory`, `get_coverage_for_module`.

### P2-2 · MCP server packaging
**Problem**: the project is a web app island. It should be an MCP server callable from Claude Code / Cursor.

**Deliverable**: `server/src/mcp/` exposing: `evaluate_project`, `get_evaluation`, `list_roles`, `get_reflection`, `verify_mrep_claims`, `get_judge_score`.

### P2-3 · Eval harness with golden dataset
**Problem**: A/B test compares on the same live project, not a fixed dataset.

**Deliverable**: `evals/datasets/` with 20-30 reference projects + `evals/run.ts` harness + CI gate.

### P2-4 · Streaming output to frontend
**Problem**: users wait 30-120s staring at a progress bar.

**Deliverable**: `client.ts` exposes `streamChat()`, WebSocket emits `role_token` events, frontend renders partial output.

---

## P3 — Productionization (not started)

### P3-1 · Persistent task queue
Back the in-memory queue with SQLite. On restart, pending jobs re-enqueue.

### P3-2 · SQLite evaluation store
Replace JSON file persistence with SQLite schema for evaluations, traces, reflections, mrep_reports, judge_scores, prompt_overrides.

### P3-3 · Authn / authz
API key middleware + project root allowlist + path traversal prevention.

### P3-4 · Rate limiting
Per-key rate limit integrated with queue scheduler.

### P3-5 · Secret scrubbing
Pre-prompt scrubber for AWS keys, private keys, .env values before analysis hits any LLM.

---

## Deployment

### Alibaba Cloud SG ECS (production-tested 2026-04-12)
- Instance: 4 vCPU / 8GB / 70GB ESSD, Alibaba Cloud Linux 3
- Public IP: 47.84.177.66:9000
- Stack: Node.js 20 + pm2 + dist/index.js
- Providers configured: Claude (Anthropic) + DeepSeek
- Deploy script: `deploy.sh` (one-shot, curl-pipeable)
- Dockerfile available for container deployments

### Why SG?
Anthropic API returns 403 from China mainland IPs. SG ECS provides a clean exit point for Claude API calls.

---

## Pricing discussion (preserved, not yet actioned)

- **Positioning**: "launch readiness judge", not "AI code review" — escapes the $15-30/mo ceiling.
- **Starter tiering**: Free ($0, 3 quick evals/month) → Pro ($19/mo, 50 evals) → Team ($79/mo, 300 evals) → Enterprise (custom, $500+/mo).
- **Domain Packs**: TradeExpert, supply_chain_expert as $29/mo add-ons.
- **Pay-per-Pass**: $5/eval, only charged when grounded-judge quality score passes threshold.
- **Billing unit**: one `evaluate_project` call = 1 eval. Reflection / MREP / judge do NOT bill separately.
- **Revisit after P2-2 ships** (MCP server). Don't finalize pricing before the MCP distribution channel is live.

---

## Working agreement

- **Do NOT touch methodology**. Role prompts, MREP schema, judge dimensions, evolution loop stay as-is unless a specific task says otherwise.
- **Backward compatibility is non-negotiable for P0**. Existing API consumers and web UI must keep working.
- **One PR per numbered item**. Each PR includes a focused test.
- **Observability before optimization**: ship tracer before context filter so we can measure impact.
- **Prompts live in `server/src/ai/roles.ts`** (no parallel prompt directory).
- **Temperature discipline**:
  - `0.0` — judge, reference-builder, MREP verifier, schema-validation retry
  - `0.3` — reflection synthesis, prompt override generation
  - `0.7` — role evaluation, orchestrator debate, community searcher, user interviews
- Always add a test when changing a non-trivial LLM call path.
- **Known design tradeoff**: P1-2 context filter gives each role a different analysis prefix, which reduces Claude prefix-cache sharing across roles. Each role creates its own cache entry. Future optimization: group roles by identical filter output to maximize shared cache.
