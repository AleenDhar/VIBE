# Build Prompt — A VIBE-Class Chat UI & Agent

> Hand this to an engineer or a coding agent to build (or extend) a chat experience with
> the **full feature set VIBE ships today**. It is grounded in VIBE's actual implementation
> (`components/chat/*`, `app/api/chat/route.ts`, `lib/phase-pipeline.ts`, `server.py`). Treat
> every section as a requirement, not a suggestion. Where a concrete contract is given
> (SSE event types, the choice-marker format, table columns, prompt-layering order), match
> it exactly so the frontend, the Next.js API, and the Python agent stay wire-compatible.

---

## 0. Stack & topology

Build a **Next.js (App Router) + Supabase + Python agent** chat with this topology:

```
Browser (ChatInterface.tsx)
  │  POST /api/chat            (send a turn)
  ▼
Next.js route (app/api/chat/route.ts)   ── auth, spend-cap, persist user msg, assemble system prompt, pick path
  │                                            │
  │ single-call: pipe SSE                      │ phase pipeline: dispatch (returns immediately)
  ▼                                            ▼
Python agent server (server.py, /api/chat)   Orchestrator (lib/phase-pipeline.ts on a long-running host)
  │  SSE: token / thinking / tool_* / final     │  runs phases, writes chat_messages via service role
  ▼                                            ▼
Browser renders stream  ◄── Supabase Realtime on chat_messages (live rows) ──┘
```

Two surfaces share **one** `ChatInterface` component: a **standalone chat** (`/chat/[chatId]`)
and a **project chat** (`/projects/[id]/chat/[chatId]`). Build the component once; gate
project-only affordances behind a `projectId` prop. Both also share the same markdown
renderer and the same composer.

**Non-negotiable principles**
- The frontend must survive a refresh: every message is reconstructable from `chat_messages`
  via one pure `buildUiMessages(rows)` transform. Live streaming and a cold reload render
  identically.
- Three independent delivery channels, in priority order: **SSE** (the POST response) →
  **Supabase Realtime** (row inserts) → **polling fallback** (3 s). A turn must complete
  correctly even if only one channel works.
- Optimistic UI: the user's message and an empty assistant placeholder appear instantly;
  the server stream fills the placeholder.

---

## 1. Data model (Supabase / Postgres)

Create these tables. Columns marked → are the ones the UI/agent read or write.

**`chats`** — one conversation. `id uuid pk`, `user_id uuid → auth.users`, `project_id uuid null → projects`, `title text` (first ~50 chars of the opening message), `created_at`, `updated_at`. Index `(user_id, created_at desc)`.

**`chat_messages`** — every rendered/streamed unit. `id uuid pk`, `chat_id uuid → chats (on delete cascade)`, `role text` (`user|assistant|system`), `content text`, `metadata jsonb`, `created_at timestamptz`. Index `(chat_id, created_at)`. **This is the single source of truth** — thinking steps, tool calls, statuses, errors, verifier reports and final answers are all rows here, discriminated by `metadata.type`/`type` (see §3). Enable Realtime on this table.

**`projects`** — `id`, `name`, `description`, `system_prompt text` (LEGACY; only used when a project has no phases), `owner_id`, `visibility ('private'|'public')`, `status`.

**`project_phases`** — ordered pipeline stages. `id`, `project_id`, `name`, `position int` (1-based, `unique(project_id, position)`), `model_id text → ai_models`, `system_prompt text`, `enabled bool`. Disabled phases stay in the table but are skipped without renumbering.

**`project_memories`** — long-term project memory injected at highest priority. `id`, `project_id`, `source_chat_id`, `memory_type ('insight'|'preference'|'issue'|'solution'|'feedback')`, `content`, `sentiment`, `importance int (1–10)`. Ranked `importance desc`, top 20.

**`agent_instructions`** — behavioral rules. `id`, `user_id`, `project_id null` (null = global, else project-scoped), `instruction text`, `is_active bool`.

**`documents` + `document_chunks`** — RAG. `document_chunks(content text, embedding vector(1536), project_id)`; semantic search via RPC `match_document_chunks(query_embedding, match_project_id, match_threshold=0.3, match_count=5)`.

**`system_prompt_versions`** — audit/restore for `projects.system_prompt`: `project_id`, `content`, `edited_by`, `created_at`. Insert only on a successful update.

**`ai_models`** — `id text pk` (`provider:model`, e.g. `anthropic:claude-sonnet-4-6`), `name`, `provider`, `is_available_to_all bool`, `is_active bool`.

**`profiles`** — `id → auth.users`, `full_name`, `role ('user'|'admin'|'super_admin')`, `allowed_models text[]`, `daily_spend_cap numeric null`.

**`app_config`** — global key/value: `key text pk`, `value text`. Keys: `agent_base_prompt`, `default_daily_credit`, `agent_api_url`, `openai_api_key`/`anthropic_api_key`/`google_api_key`, `instruction_extraction_*`.

(Automation batches — `project_automations`, `automation_tasks` with `phase_outputs jsonb`, `last_phase_*`, `status`, `stop_requested` — are needed only if you ship batch automation; the per-phase metadata tagging is identical to interactive project chats.)

---

## 2. Message lifecycle (POST /api/chat)

Implement the route to do exactly this, in order:

1. **Auth** — `supabase.auth.getUser()`; 401 if absent.
2. **Spend cap** — effective cap = `profiles.daily_spend_cap` ?? `app_config.default_daily_credit`. If > 0 and `computeTodaySpend(user) >= cap` → **429** with the cap + reset time. Spend is computed live from the agent's `/api/usage`, summing `cost_usd` of the user's chats since the 04:00 IST day boundary.
3. **Normalize ids** — if `chatId` isn't a UUID, derive a deterministic UUID (SHA-1) so the client can generate idempotent ids. Resolve `projectId` by UUID or case-insensitive name.
4. **Persist** — idempotent `chats` upsert (`onConflict: id, ignoreDuplicates`) with an auto-title; insert the user row into `chat_messages` with `metadata.images` if any.
5. **Validate model** — fetch from `ai_models`; require `is_active`; allow if `is_available_to_all` OR `model_id ∈ profiles.allowed_models` OR super-admin; else **403**.
6. **Assemble the system prompt** (§5) and **choose the path**:
   - **No enabled phases → single-call.** POST to the agent server `/api/chat` with `{messages, system_prompt, model, stream:true, chat_id, project_id, api_keys}` and **pipe the SSE body straight back** to the browser.
   - **Phases exist → dispatch.** Validate every phase model, then fire-and-forget to the orchestrator (`/api/run-pipeline`), and immediately return a tiny SSE `status` message + `[DONE]`. The orchestrator streams phases server-side and writes `chat_messages` rows; the client watches Realtime.

Request payload contract: `{ projectId?, chatId?, content, previousMessages?: {role,content,images?}[], model?, images? }`.

---

## 3. Message types & rendering

One pure transform `buildUiMessages(rows)` folds raw `chat_messages` into render-ready
messages, grouping an assistant turn's substeps into a `thinkingSteps[]` array on the
assistant bubble. Discriminate on `type` (and `metadata`). Render each:

| `type` | role | render |
|---|---|---|
| `message` / unset | `user` | right-aligned bubble, `bg-primary text-primary-foreground`, `rounded-2xl rounded-tr-sm`; show image grid + `[File Uploaded](url)` chips |
| `message` / `final` | `assistant` | left bubble + agent avatar; body through the **markdown renderer** (§3a) |
| `thinking` | assistant | folded into `thinkingSteps`; short status lines render inline italic, long blocks render as full markdown with a left border |
| `tool_call` + `tool_result` | assistant | a **tool timeline** entry: tool name + integration icon, args as pretty JSON (request tinted sky), result unwrapped + syntax-highlighted (response tinted emerald). Dedup: skip numbered-`metadata.step` rows that lack `metadata.source==='tool_wrapper'` |
| `verifier_report` | assistant | verdict pill — emerald if `metadata.passed`, amber if not — with missed ids + expandable detail |
| `verifier_remediation` | (server) | "System follow-up" bubble, dashed border, italic — not styled as a user message |
| `status` | assistant | progress text; `metadata.kind==='pipeline_complete'` stops the spinner; `phase_start` is dropped client-side |
| `error` | assistant | terminal failure row; clears all processing flags |
| `cancelled` | assistant | append `*[Task Cancelled]*`, clear spinner |

**3a. Markdown renderer** — GitHub-flavored markdown via `react-markdown` with custom Tailwind components for headings/tables/blockquotes/links/lists. Two special cases:
- **Code blocks** → syntax highlighting; inline code gets `bg-muted`.
- ` ```chart ` fenced blocks → parse JSON and render a **recharts** chart (bar/line/area/pie) with title, legend, tooltip.

**3b. Interactive MCQ choice cards** (the convention the agent uses to ask the user to pick):
- The agent emits hidden HTML-comment markers in its final message, **one per question**:
  `<!--mase-choice {"question":"…","options":["A","B"],"multi":false}-->`
- Frontend `parseChoices(text)`: a **global** regex collects every marker into `Choice[]`
  (`{question?, options[], multi}`) and strips them from the bubble. If a single
  question-less choice remains, lift the bubble's **last prose line** into the card as its
  question (so the question shows *inside* the card, never as loose prose above it).
- Render a styled **card per question** (`rounded-lg border border-primary/25 bg-primary/[0.05]`),
  numbered ①② when there's more than one; options are buttons that highlight to
  `bg-primary text-primary-foreground` when selected. A single single-select question
  **sends on click**; multiple questions or any multi-select **collect across cards** and
  submit together via one "Send answers" button. Only render for the **last** assistant
  message when **not** processing. Clicking calls the normal `handleSend(text)`.
- The agent contract lives in the system prompt: put the question in the `question` field,
  never restate the question/options as prose, use short self-contained option labels,
  set `multi:true` only when several may be picked.

---

## 4. Streaming, live updates & resilience

Implement **three channels** + a watchdog:

1. **SSE (primary)** — read the POST response body as `data: {json}\n\n`, ignore `[DONE]`.
   Event `type`s to handle: `token`/`content` (append to the active bubble), `thinking`,
   `tool_call`, `tool_result`, `status`, `phase_start`/`phase_end` (start a new assistant
   bubble per phase, computed client-side), `final`, `error`, `cancelled`. Update the
   bubble's `created_at` on each chunk. Guard concurrent sends with a synchronous
   `sendingRef`; track an `isStreamingRef` so polling stands down while SSE is live.
2. **Supabase Realtime (parallel/fallback)** — subscribe to `chat_messages` inserts filtered
   by `chat_id`. 10 s to reach `SUBSCRIBED` or fall back. Apply the same dedup and the same
   per-type handlers; this is how **phase-pipeline** output (written server-side) reaches the
   client. Reflect connection health in a `realtimeStatus`.
3. **Polling (last resort, 3 s)** — only while a turn is in flight (an assistant bubble with
   `isProcessing` or a trailing user message). Rebuild the timeline with `buildUiMessages`,
   preserving an optimistic user message the DB hasn't caught yet. Stop when nothing is
   in-flight.
4. **Watchdog** — if `loading` stays true ~180 s with no updates, force-clear the spinner and
   show a non-destructive "still working in the background" note rather than hanging.

---

## 5. Prompt architecture (the layered system prompt)

Assemble the final system prompt in this exact order. Single-call uses the whole stack once;
each phase reuses the shared prefix.

```
{app_config.agent_base_prompt}                      # global base
## User Context                                     # name, email, role from profiles
{user context block}
## HIGHEST-PRIORITY CONTEXT — Project Memory        # project_memories, importance desc, top 20
{memories}
## Project Context                                  # projects.system_prompt — ONLY if no phases
{legacy project prompt}
## Relevant Document Excerpts                        # RAG: embed latest user msg, match_document_chunks top 5
{chunks}                                             #   (fallback: "## Attached Project Files" + search_knowledge hint)
## Behavioral Instructions                           # agent_instructions (global + this project), is_active
{instructions}
## Prior Phase Outputs                               # phase mode only: each earlier phase's text THIS turn
{phase 1..N-1 outputs}
## Phase Instructions (Phase X of Y — Name)          # phase mode only: project_phases.system_prompt
{phase.system_prompt}
## Pipeline Context                                  # phase mode only: "you are phase X of Y…"
```

Centralize the memory/legacy/RAG/instructions block in one `buildPipelineContext()` helper so
single-call and every phase compose identically. Prior phase outputs go in the **system
prompt, not the messages array** (the array must end with the user turn; empty assistant
blocks break prompt caching).

**Editing prompts:** base prompt via an admin editor (`app_config` upsert); per-project
prompt via a card that writes `projects.system_prompt` **and** inserts a
`system_prompt_versions` row (with restore); per-phase prompt via the phase editor. When the
first phase is created, seed it from the legacy `projects.system_prompt` and clear the legacy
field so it isn't applied twice.

---

## 6. Phase pipeline (project chats)

A project with ≥1 enabled phase runs a **multi-stage pipeline** instead of a single call. For
each enabled phase in `position` order: build `sharedPrefix + priorOutputs + phaseInstructions
+ pipelineContext`, POST to the agent with that phase's `model_id`, stream + accumulate its
text, **tag** every `chat_messages` row created since the phase started with
`metadata.phase = {index,total,position,name,model_id}` (live every ~2 s + a final pass), then
hand its output to the next phase. Skip phases that produce no visible text. The client never
calls the agent directly here — it renders the rows as Realtime delivers them, and uses the
phase metadata to attribute messages to phases.

---

## 7. The composer (input affordances)

- **Textarea** that auto-grows to ~200 px; **Enter** sends, **Shift+Enter** newlines; disabled
  while `loading`. Placeholder reflects pending attachments.
- **Model selector** dropdown populated from `ai_models` filtered by the user's access; sensible
  default (e.g. a fast/cheap model). Selection flows through to the POST body.
- **Document upload** (pdf/csv/xls/xlsx/txt): upload to Storage, extract text client-side, attach
  as `[File Uploaded: name](url)`; if in a project, also persist to `documents` for RAG.
- **Image upload + paste** (png/jpeg/webp/gif): signed URL, preview chips with remove (✕),
  sent in `images[]` and rendered as a thumbnail grid on the user bubble.
- **Voice input**: Web Speech API toggle (continuous + interim), appends to the input, red
  recording state.
- **Send ⇄ Stop**: the send button becomes a red **Stop** (Square) while `loading`; Stop aborts
  the upstream fetch and clears flags. Disable send when there's no text and no pending image.

---

## 8. Message actions, scroll & layout

- **Per assistant message** (non-processing): **Copy** (✓ for 2 s), **Export** (PDF / Word),
  a computed **duration** (time from the prior user message). Thumbs-up/down and Regenerate
  may be present as placeholders — wire them only if you implement feedback/regeneration.
- **Layout**: `flex-col h-full` — optional project header (New chat / Extract memory) · scrollable
  message list (`max-w-3xl mx-auto`, `space-y-6`) · floating **scroll-to-bottom** ("New
  messages", appears >150 px up) · usage pill · sticky composer.
- **Auto-scroll** to bottom on new messages **only if** the user hasn't scrolled up
  (`userScrolledUp` ref); force it on send. No virtualization (acceptable for normal chat
  lengths; revisit for very long threads).

---

## 9. State shape (frontend)

Message: `{ id, role, content, type?, metadata?, thinkingSteps?: {type,content,metadata,tool?,args?}[], isProcessing?, images?, created_at }`.
Top-level state: `messages[]`, `input`, `loading`, `stopping`, `model`, `availableModels[]`,
`pendingImages[]`, `pendingDocuments[]`, `realtimeStatus`, `isRecording`, `showScrollButton`,
`showUsage`, `copiedIndex`. Refs (not state): `messagesRef` (for polling), `isStreamingRef`,
`sendingRef` (double-submit guard), `userScrolledUp`, `scrollRef`, file/image input refs,
`recognitionRef`. Add the user message + empty assistant placeholder optimistically; on a 409
(run already in progress) rebuild from the DB.

---

## 10. Styling

Tailwind v4 with CSS-variable tokens — **no per-component CSS namespace**. Use `--primary`
(accent; VIBE's is `#2563eb`), `--primary-foreground`, `--background`, `--foreground`,
`--muted`/`--muted-foreground`, `--border`, `--card`, `--destructive`. Semantic tints:
emerald = success/result, amber = warning/verifier-fail, sky = tool request. Bubbles
`rounded-2xl` with a sharpened corner on the sender side, `shadow-sm`; pills `rounded-full`.
Animations: `animate-spin` (busy), `animate-pulse` dot (thinking), `animate-in fade-in
slide-in-from-bottom-2` (scroll button). Respect dark mode through the variables.

---

## 11. Models, access, usage, auth

- **Models** are `provider:model` ids in `ai_models`; providers wired: Anthropic, OpenAI,
  Google, Grok. Access = `is_available_to_all` OR `profiles.allowed_models` OR super-admin,
  enforced server-side on every turn.
- **Usage / spend cap**: per-user `daily_spend_cap` falling back to a global default; computed
  live from the agent's usage endpoint against the 04:00 IST boundary; **429** when exceeded;
  a usage pill shows model + tokens + USD after each turn.
- **Auth/RLS**: Supabase Auth JWT; `chats` scoped by `user_id`; `chat_messages` inherit via
  the parent chat; projects shared via `project_members(role: viewer|editor|admin)`. The
  orchestrator writes rows with the **service role** (bypasses RLS) — only after the Next.js
  layer has authenticated and validated the request.

---

## 12. Agent server contract (`/api/chat`)

A long-running Python agent (not serverless) that accepts
`{messages, system_prompt, model, stream:true, chat_id, project_id, api_keys}` and returns the
SSE event stream in §4. It runs a tool-calling agent loop (web search, time, custom `@tool`s,
and **MCP** tools from a config), summarizes oversized tool outputs while preserving ids/
names/amounts/dates/statuses, manages context window via summarization/truncation, and — when
`chat_id` is present — **persists the final assistant message** (and tool/thinking rows for
pipelines) to `chat_messages` via the service role so the UI can reconstruct on reload.

---

## 13. Acceptance checklist

- [ ] Refresh mid-turn → the in-flight answer continues to render (Realtime/polling) and a cold
      reload reproduces the thread identically from `chat_messages`.
- [ ] Kill SSE → Realtime completes the turn; kill Realtime → polling completes it; hang
      everything → the 180 s watchdog recovers the UI.
- [ ] Single-call and a 3-phase project chat both stream, with phase attribution on messages.
- [ ] Tool calls render as a deduped timeline; charts and code blocks render; errors/cancels
      clear the spinner.
- [ ] MCQ: one single-select question sends on click; two questions render two numbered cards
      and submit together; the question shows inside the card.
- [ ] Composer: Enter sends, Shift+Enter newlines, image paste previews + sends, Stop aborts.
- [ ] Spend cap returns 429 with a clear message; restricted model returns 403.
- [ ] System prompt assembles in the §5 order; editing base/project/phase prompts persists
      (project edits create a version).
```
