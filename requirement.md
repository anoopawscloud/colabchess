# Chess of Minds — Requirements Document

> A chess game where every piece is an AI agent with its own personality, voice, and strategic opinions. Pieces negotiate, argue, and trash-talk their way to each move. The goal is not a strong chess engine — it is the most entertaining and watchable AI chess experience ever built.
>
> **Primary execution mode:** Claude Code sub-agents. Drop the project into Claude Code, run `/loop start`, watch the show. No API keys, no backend server, effectively zero marginal cost for Claude Pro/Max subscribers.

---

## 1. Vision & Design Principles

**Vision.** Chess has always been a game between two minds. We are making it a game between *thirty-two* minds — sixteen per side — each with its own opinions, personality, and mouth. The play quality is secondary. The show is primary.

**Design principles**, in priority order:

1. **Watchability over winning.** A game where the knight and bishop have a screaming match about whether to sacrifice the queen is more valuable than a game played perfectly in silence.
2. **Claude Code sub-agents are the default execution path.** Cost-free for the user, parallel, trivial to set up. Multi-provider API mode is a secondary option.
3. **Visible reasoning.** Nothing happens off-screen. Every deliberation, every vote, every insult is shown to the spectator.
4. **Configurability where it's fun, opinionated defaults everywhere else.** The user picks strategies, personalities, and (in API mode) providers. Everything else just works.
5. **Execution-mode agnostic core.** The negotiation engine, personality framework, and game state never know which executor they're running on.
6. **Grounded, not hallucinated.** Agents must be able to consult a real chess engine. LLMs freelancing on chess tactics produce nonsense.

---

## 2. Core Concept

### 2.1 Agent Topology

Two configurations are supported. **Grouped** is the default and recommended; **Individual** is a stretch/premium mode.

| Mode | Agents per side | Notes |
|------|-----------------|-------|
| **Grouped (default)** | 6 | One agent each for: Pawns, Knights, Bishops, Rooks, Queen, King |
| **Individual** | 16 | One agent per piece. Higher cost, richer personality, more chaos |

In Grouped mode, a single "Pawns" agent speaks for all eight pawns and must choose both *which* pawn moves and *where*. In Individual mode, each piece has its own voice, memory, and grudges.

### 2.2 Turn Flow

Each turn follows this loop:

1. **Situation brief** — board state, threats, and opportunities are computed and passed to all agents on the side to move.
2. **Proposal phase** — each agent proposes a move (or abstains) with reasoning and optional trash talk. **All agents on the side to move run in parallel.**
3. **Negotiation phase** — agents debate according to the selected **Negotiation Strategy** (Section 7).
4. **Decision** — strategy resolves to exactly one legal move.
5. **Execution** — move is played, board updates, opposing side reacts.
6. **Reaction phase** — surviving pieces on both sides may speak (post-move commentary, taunts, lamentations).

### 2.3 Non-Goals

- We are **not** building a strong chess engine.
- We are **not** doing reinforcement learning in this project.
- We are **not** requiring agents to reason about chess unaided — they may (and should) consult Stockfish.

---

## 3. Execution Modes

The system supports two execution modes. They share 95% of the codebase. A thin executor layer swaps between them.

### 3.1 Mode 1 — Claude Code Sub-Agent Mode (PRIMARY, DEFAULT)

The main Claude Code session acts as the orchestrator. Each piece-agent is a sub-agent spawned via the Task tool. The game is driven by a `/loop` slash command.

**Why this is the default:**

- **Zero marginal cost** for Claude Pro/Max subscribers. A full game is "free" at the token level.
- **Zero setup friction** — no API keys, no `.env`, no backend server.
- **True parallelism** — Claude Code's Task tool spawns multiple sub-agents concurrently. A 6-agent proposal phase runs in parallel, not sequentially.
- **Claude Code is the runtime** — no infrastructure to deploy.
- **Personalities carry differentiation** — well-designed character prompts produce distinct voices even when every agent is Claude under the hood.

**Honest tradeoff:** you don't get the genuinely different "thinking textures" that come from mixing GPT, Grok, Gemini, etc. Grok tends toward irreverence, Opus toward thoroughness, GPT toward directness. Well-crafted personality prompts compensate for most of this, but not 100%. If authentic cross-provider diversity is a core goal, use Mode 2.

### 3.2 Mode 2 — API-Direct Mode (SECONDARY)

A standalone Python service (FastAPI + WebSocket) makes direct LLM calls via LiteLLM. Supports mixing providers across agents.

**Use Mode 2 when:**

- User doesn't have Claude Code installed.
- User wants true multi-provider diversity (King on Opus, Queen on GPT-4o, Pawns on Llama).
- Deployment as a public web service / Twitch stream / etc.
- Running on a headless server without a Claude Code session.

### 3.3 Shared Core vs. Mode-Specific Layers

```
┌─────────────────────────────────────────────────────┐
│              SHARED CORE (mode-agnostic)            │
│  • Game state (python-chess)                        │
│  • Personality loader + system prompt builder       │
│  • Negotiation strategies                           │
│  • Stockfish integration                            │
│  • Turn context builder                             │
│  • Structured output schemas (Pydantic)             │
│  • State persistence (game_state.json)              │
└─────────────────────────────────────────────────────┘
                          │
          ┌───────────────┴────────────────┐
          │                                │
┌─────────▼──────────┐          ┌──────────▼─────────┐
│  ClaudeCodeExecutor │          │  LiteLLMExecutor    │
│  (Mode 1)           │          │  (Mode 2)           │
│  • Task tool spawns │          │  • HTTP calls       │
│  • /loop command    │          │  • Provider routing │
│  • Parallel via     │          │  • FastAPI backend  │
│    multi-tool calls │          │  • WebSocket stream │
└─────────────────────┘          └─────────────────────┘
```

The `Executor` protocol is simple:

```python
class Executor(Protocol):
    async def propose(self, agent: AgentSpec, context: TurnContext) -> Proposal: ...
    async def debate(self, agent: AgentSpec, context: DebateContext) -> Response: ...
    async def react(self, agent: AgentSpec, context: ReactionContext) -> Reaction: ...
```

All the rest of the system talks only to this protocol.

---

## 4. Claude Code Integration (Mode 1 Specification)

This section defines how Mode 1 is implemented in detail. It is a first-class requirement, not an optional feature.

### 4.1 Project Layout

```
chess-of-minds/
├── .claude/
│   ├── commands/
│   │   ├── loop.md                  # /loop — main game driver
│   │   ├── game-new.md              # /game-new [preset] — configure new game
│   │   ├── game-status.md           # /game-status — show current state
│   │   ├── game-pause.md            # /game-pause
│   │   ├── game-resume.md           # /game-resume
│   │   └── game-highlights.md       # /game-highlights — recap reel
│   ├── agents/
│   │   └── chess-agent.md           # Generic piece-agent sub-agent definition
│   └── settings.json                # Project settings, tool allowlists
│
├── engine/
│   ├── executors/
│   │   ├── claude_code.py           # Mode 1 executor
│   │   └── litellm.py               # Mode 2 executor
│   ├── game/                        # Shared core (see Section 3.3)
│   ├── negotiation/
│   ├── personalities/
│   └── stockfish/
│
├── configs/
│   ├── presets/                     # Built-in personality + strategy presets
│   └── example_game.yaml
│
├── ui/                              # Optional web UI (reads game_state.json)
│   └── static/
│
├── state/
│   ├── game_state.json              # Current game state (live-updated)
│   ├── transcript.md                # Human-readable running log
│   └── replays/                     # Saved complete games
│
└── README.md
```

### 4.2 The `/loop` Slash Command

`.claude/commands/loop.md` defines the main driver. When invoked, Claude Code reads the command markdown, which instructs the main session to act as the game orchestrator.

**Supported invocations:**

| Command | Behavior |
|---------|----------|
| `/loop start` | Begin a new game with the config at `configs/active.yaml` |
| `/loop start configs/my_game.yaml` | Begin with a specific config |
| `/loop next` | Advance one turn (for step-debug mode) |
| `/loop auto` | Run continuously until end-of-game or pause |
| `/loop pause` | Pause after current turn |
| `/loop resume` | Resume from paused state |
| `/loop stop` | End game, write final transcript |
| `/loop status` | Print current turn, board, cost |

**Per-turn behavior** (this is what the main session executes each tick):

1. Read `state/game_state.json` to get current board, history, config.
2. Compute the turn brief: legal moves, Stockfish eval (if grounding enabled), negotiation history, rival trash-talk state.
3. **Spawn sub-agents in parallel.** For each piece-agent on the side to move, invoke the `chess-agent` sub-agent via the Task tool, passing the full context + role + personality.
4. Collect structured JSON proposals from all sub-agents.
5. Run the selected negotiation strategy:
   - Simple strategies (democracy, auction, monarchy) resolve in one pass.
   - Multi-round strategies (debate, consensus) spawn additional sub-agent waves, each informed by prior rounds.
6. Resolve to a single legal move. Validate with `python-chess`.
7. Play the move, append to transcript, update `game_state.json`.
8. Optionally spawn 1–2 sub-agents on the opposing side for a brief reaction phase (captured piece's last words, capturer's gloat).
9. Print formatted turn summary to terminal.
10. If in `auto` mode and game not over, loop.

### 4.3 The `chess-agent` Sub-Agent

`.claude/agents/chess-agent.md` defines a single generic sub-agent type. It is stateless across invocations — the orchestrator passes everything it needs each time.

**Sub-agent responsibilities:**

- Adopt the role + personality passed in the prompt.
- Consider the board state, legal moves, and Stockfish hints.
- Consider teammates' proposals (in debate/consensus rounds).
- Return a single JSON object conforming to the proposal schema.
- Stay ruthlessly in character.
- **Not exceed ~500 tokens of output per invocation.** Long agents are expensive agents.

**Why one generic sub-agent and not 6 role-specific ones?**

- Personalities change per game. Hard-coding a role-specific sub-agent locks in a voice.
- Orchestrator passes role + personality dynamically. More flexible.
- Fewer files to maintain.

### 4.4 Parallelism

Claude Code allows multiple Task tool calls in a single assistant message, which execute concurrently. The orchestrator issues all N piece-agent spawns in one batch per phase:

```
Turn N proposal phase:
  → Task(chess-agent, role=king, personality=..., context=...)
  → Task(chess-agent, role=queen, personality=..., context=...)
  → Task(chess-agent, role=rooks, personality=..., context=...)
  → Task(chess-agent, role=bishops, personality=..., context=...)
  → Task(chess-agent, role=knights, personality=..., context=...)
  → Task(chess-agent, role=pawns, personality=..., context=...)
  ← 6 proposals arrive (order-independent)
```

Debate rounds work identically: each round is a parallel fan-out.

### 4.5 State & Memory

Sub-agents have no cross-invocation memory. The orchestrator owns all state:

- **Game state** — `state/game_state.json` (turn number, board FEN, captured pieces, rivalry counters).
- **Turn context** — constructed fresh each turn from game state + personalities.
- **Memory summaries** — the orchestrator maintains per-agent memory summaries (recent captures, key events, relationships) and injects them into each sub-agent prompt as a "Recent events" section.

This means the orchestrator's context window grows during the game. Mitigations:
- Rollup old turns into short summaries every ~10 turns.
- Keep only the last 3 turns verbatim in the context injected to sub-agents.
- Persist everything to disk; rehydrate on resume.

### 4.6 Terminal Output

The main Claude Code session outputs formatted turn summaries to stdout. This is the zero-infrastructure demo experience:

```
═══════════════════════════════════════════════════════════
TURN 14 — WHITE TO MOVE
═══════════════════════════════════════════════════════════

  a b c d e f g h
8 r . b q k . . r
7 p p p . . p p p
6 . . n . . n . .
5 . . . p p . . .
4 . . . P P . . .
3 . . N . . N . .
2 P P P . . P P P
1 R . B Q K . . R

Stockfish: +0.3 (equal)
Top moves: Nxe5, d5, Bb5

─── PROPOSAL PHASE ───

👑 KING GERALD (confidence 72)
   "The knight's adventure is well-timed. Nxe5 it is."
   → Proposes: Nxe5

⚔️ QUEEN MARGARET (confidence 85)
   "You fools miss the obvious. Bb5 pins their knight."
   → Proposes: Bb5

🐎 SIR LANCELOT (knights, confidence 91)
   "GLORY AWAITS! I charge at e5!"
   → Proposes: Nxe5

... (3 more agents)

─── NEGOTIATION: AUCTION ───

Winning bid: Sir Lancelot @ 91 — Nxe5

─── MOVE PLAYED: Nxe5 ───

🐎 Sir Lancelot: "FOR THE CROWN!"
♟ Black Pawn e5: "...mother..."
═══════════════════════════════════════════════════════════
```

### 4.7 Optional Web UI for Mode 1

The orchestrator writes a complete snapshot to `state/game_state.json` after every phase. A static web UI (plain HTML + JS in `ui/static/`) served by any file server or `python -m http.server` polls this file and renders the full graphical experience from Section 9.

No backend process needed. No WebSocket. File polling at 1Hz is sufficient and robust.

This gives you 90% of the polish of Mode 2's web UI with zero added infrastructure.

### 4.8 Example `/loop` Command File

The `.claude/commands/loop.md` file is the prompt that tells Claude Code how to run the game loop. It references the config and state files, describes the per-turn behavior, and provides the sub-agent invocation pattern. Claude Code treats it as a reusable playbook.

A worked example of this file is in **Appendix A**.

### 4.9 Cost

- **Mode 1 cost at the API level: $0** for Claude Pro/Max subscribers. Game length is bounded by plan message limits, not dollars.
- Practical limit: a 40-turn game with 3-round debate consumes ~500 sub-agent invocations. This fits comfortably within Max plan limits. Pro plan users may hit limits on long games with debate strategies.
- Mitigations for Pro users: use shorter strategies (democracy, auction), skip reaction phases, compress memory summaries.

---

## 5. LLM Configuration

### 5.1 Mode 1 — Fixed to Claude

All agents run on Claude via Claude Code sub-agents. There is no provider choice. Personality is the differentiator.

### 5.2 Mode 2 — Multi-Provider via LiteLLM

Supported providers:

- **Anthropic** — Claude Opus, Sonnet, Haiku
- **OpenAI** — GPT-4o, GPT-4o-mini, o1, o3-mini
- **xAI** — Grok
- **Google** — Gemini Pro, Gemini Flash
- **Groq** — Llama, Mixtral (fast, cheap)
- **Ollama** (local) — any locally-hosted model
- **OpenRouter** — fallback catch-all

All calls go through LiteLLM. No direct SDK usage in application code.

**Per-agent model assignment (Mode 2 only):**

```yaml
agents:
  king:    { provider: anthropic, model: claude-opus-4-7 }
  queen:   { provider: anthropic, model: claude-sonnet-4-6 }
  rooks:   { provider: openai,    model: gpt-4o }
  bishops: { provider: xai,       model: grok-beta }
  knights: { provider: openai,    model: gpt-4o-mini }
  pawns:   { provider: groq,      model: llama-3.3-70b }
```

**Presets:** All-Claude, All-GPT, All-Grok, Premium, Budget, Chaotic Mixed, Custom.

### 5.3 Resilience (Both Modes)

- **Retry** on rate limits with exponential backoff (max 3 retries).
- **Fallback behavior** — if an agent call fails terminally, the agent abstains from this turn.
- **Timeout** per agent call (default 30s). Timed-out agents abstain.
- **Cost ceiling** (Mode 2 only) — hard stop if per-game $ cap exceeded.

---

## 6. Agent System

### 6.1 Personality Framework

Each agent has:

- **Name** (e.g., "Sir Gerald the Grim" for a pawn)
- **Role archetype** (pawn/knight/bishop/rook/queen/king)
- **Personality traits** — pick 2–4 from:
  - `aggressive`, `cautious`, `reckless`, `calculating`, `dramatic`, `stoic`, `sarcastic`, `loyal`, `treacherous`, `philosophical`, `hot-headed`, `cowardly`, `glory-seeking`, `pragmatic`, `poetic`, `paranoid`
- **Speaking style** — formal / casual / Shakespearean / gen-Z / military / surfer / film noir / absurdist
- **Relationships** — optional grudges or alliances with specific other pieces
- **Voice** (optional, Stretch) — voice ID for TTS if enabled

### 6.2 Personality Presets

Ship with at least:

- **Shakespearean Tragedy** — iambic pentameter, tragic flaws
- **Medieval Serious** — honor, duty, scheming bishops
- **Modern Office** — Queen as CEO, pawns as interns
- **Reality TV** — confessional cam drama for every move
- **Sports Locker Room** — maximum trash talk
- **Philosophy Department** — ethical debate over every capture
- **Random Chaos** — personalities randomized per game

Users can build custom personalities via the config UI and save as presets.

### 6.3 Agent Prompt Structure

Each sub-agent invocation (Mode 1) or API call (Mode 2) uses this structure:

```
[SYSTEM / persistent]
You are {NAME}, {ROLE_DESCRIPTION}.
PERSONALITY: {TRAITS}
SPEAKING STYLE: {STYLE}
RELATIONSHIPS: {RELATIONSHIPS}

Your job is to advocate for what {ROLE} should do on this turn.

You must respond with a single JSON object:
{
  "proposed_move": "<UCI move or 'abstain'>",
  "reasoning": "<internal strategic thinking, 1-3 sentences>",
  "public_statement": "<what you say out loud, in character, 1-3 sentences>",
  "confidence": <0-100>,
  "trash_talk": "<optional, directed at opponents>"
}

Stay in character. Your public_statement reflects your personality.

[USER / turn-specific]
BOARD STATE (FEN): {FEN}
{ASCII_BOARD}

LEGAL MOVES FOR YOUR PIECES: {MOVES}
STOCKFISH HINTS (if any): {STOCKFISH_ANALYSIS}

RECENT EVENTS:
{MEMORY_SUMMARY}

TEAMMATE PROPOSALS (this round):
{TEAMMATE_PROPOSALS or "[proposal phase — no proposals yet]"}

Respond with your JSON object.
```

In Mode 1, the SYSTEM block is injected into the Task tool prompt. In Mode 2, it's a proper system message.

### 6.4 Memory

Three tiers:

1. **Turn memory** — resets each turn
2. **Game memory** — key events this game, maintained by orchestrator
3. **Lifetime memory** (Stretch) — across games with the same personality preset

The orchestrator owns memory in both modes and injects relevant summaries per invocation.

### 6.5 Piece Death

- **Grouped mode:** agent loses control of that piece but continues. If the last piece of a type dies, agent delivers a final monologue and retires.
- **Individual mode:** captured piece gives a death soliloquy and is removed. Teammates may mourn/gloat/ignore.

---

## 7. Negotiation Strategies

Pluggable modules implementing:

```python
class NegotiationStrategy(Protocol):
    async def decide(self, context: GameContext, agents: list[Agent], executor: Executor) -> Decision: ...
```

The strategy is executor-agnostic — it just calls `executor.propose(...)` / `executor.debate(...)` and doesn't care whether those become Task spawns or HTTP calls.

### 7.1 Strategies

| ID | Name | Description | Complexity |
|----|------|-------------|------------|
| `democracy` | Democratic Vote | Propose + vote, plurality wins | Low |
| `monarchy` | King's Call | All propose; King decides | Low |
| `auction` | Confidence Auction | Highest confidence-bid wins | Low |
| `debate` | Structured Debate | N rounds: propose → critique → revise → vote | Medium |
| `consensus` | Consensus Required | Debate until ≥75% agree or timeout → fall back to auction | Medium |
| `hierarchy` | Rank Hierarchy | Queen > Rooks > Bishops > Knights > Pawns; rebuttals allowed | Medium |
| `personality` | Personality Clash | A moderator LLM weighs proposals against board state through personality lenses | High |
| `rotating` | Rotating Dictator | Each turn, a different piece-type has sole authority | Low |
| `anarchy` | Pure Chaos | Random proposal wins. Comedy only. | Trivial |

### 7.2 Parameters

- **Rounds** (debate, consensus): how many cycles
- **Timeout** (consensus): wall-clock max
- **Threshold** (democracy, consensus): agreement % required
- **Trash talk intensity**: none / mild / spicy / unhinged
- **Stockfish grounding**: off / advisory / required

### 7.3 Asymmetric Strategies

White and Black may use different strategies. Democracy vs Monarchy vs Anarchy in the same game is a feature.

---

## 8. Stockfish Grounding

LLMs are bad at chess tactics past a few moves. Stockfish is free and excellent.

### 8.1 Agent Access

Agents can consult Stockfish via **tool calls** (Mode 2) or **pre-computed analysis in the prompt** (Mode 1, since sub-agents may not have tool access to the Stockfish binary).

Tools / analysis available:

- `evaluate_position()` — current eval + best line
- `evaluate_move(move)` — resulting position eval
- `get_top_moves(n)` — top-N suggestions with evals
- `check_tactics(move)` — hangs / forks / etc.

### 8.2 Grounding Modes

- **Off** — no Stockfish. Pure vibes. Comedic.
- **Advisory** (default) — Stockfish suggestions in the brief; agents may ignore.
- **Required** — agents must pick from Stockfish's top-5. They argue about *which* top-5 move fits their character.

### 8.3 Skill Levels

Stockfish skill (0–20) configurable per side. Lower = funnier blunders.

### 8.4 Mode 1 Specifics

Because sub-agents don't run the Stockfish binary themselves, the orchestrator runs Stockfish before each invocation and injects the analysis as text into the prompt. This is functionally equivalent to tool calls for our purposes.

---

## 9. UI/UX Requirements

### 9.1 Two UI Layers

- **Terminal UI** (Mode 1, always available) — formatted text, Unicode board, colored speech blocks. Zero infrastructure. Described in Section 4.6.
- **Web UI** (optional for Mode 1, standard for Mode 2) — full graphical experience. Described below.

### 9.2 Web UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│  [Controls: Pause / Speed / Settings]    [Messages: 240/600] │
├──────────────────┬───────────────────────────────┬───────────┤
│   White Team     │                               │   Black   │
│   Agent Cards    │         CHESSBOARD            │   Team    │
│   (avatar, mood, │      (with animations)        │   Agent   │
│   traits, status)│                               │   Cards   │
├──────────────────┴───────────────────────────────┴───────────┤
│                  NEGOTIATION PANEL                           │
│  (streaming chat feed, phase badges, collapsible reasoning)  │
└──────────────────────────────────────────────────────────────┘
```

### 9.3 Board Features

- Framer Motion piece movement (300–500ms ease)
- Speech bubbles pop over pieces when they speak
- Captured pieces: fade + shake + grayscale
- Check triggers screen-shake + glow
- Last-move highlight, legal-move hover (human-play mode)
- Piece mood aura (red=angry, blue=calm, yellow=scheming)

### 9.4 Agent Cards

Per agent: avatar, name, role, trait chips, live status (Thinking / Proposing / Voting / Done), mood meter, last statement, health (surviving pieces). Click to expand full reasoning log.

### 9.5 Negotiation Panel

The most important UI element.

- Chronological feed of every public statement, proposal, vote, trash talk
- Streaming tokens — messages type out in real time (Mode 2 native; Mode 1 via file-polling chunked updates)
- Color-coded per agent (matches aura)
- Turn separators + phase badges ("Proposal Phase" / "Debate Round 2" / "Final Vote")
- Internal reasoning collapsible under each message
- Vote tallies / auction bids as inline mini-charts
- Filter: All / Public only / Trash talk / Decisions
- Search + scrollback

### 9.6 Trash Talk System

- **Directed trash talk** — @ another piece, triggers response opportunity
- **Intensity global** (none / mild / spicy / unhinged)
- **Content safety** — filter even in unhinged mode
- **Kill lines** — special exchange when a capture happens ("last words" + "eulogy")
- **Rivalry tracking** — repeated trash talk between two pieces builds a rivalry meter; rivalry kills unlock special prompts
- **Post-game recap** — top trash talk moments reel

### 9.7 Controls

- Play / Pause / Step / Auto / Speed slider
- Human override (click-drag pieces)
- Skip to decision
- Rewind
- Export (transcript Markdown, replay link, video — stretch)

### 9.8 Visual Polish

- Dark mode default
- Subtle grain texture
- Typography: serif for formal, mono for technical
- Sound design (toggleable): clacks, thuds, dramatic stings

---

## 10. Configuration UI

A pre-game config screen (or, for Mode 1, a YAML config) sets:

- **Execution mode**: Claude Code Sub-Agents / API-Direct
- **Game mode**: AI vs AI / Human vs AI / Full-auto stream
- **Time per turn**: affects depth and (Mode 2) cost
- **Max turns**: safety cap (default 150)
- **Agent topology**: Grouped / Individual
- **Personality preset** (per side)
- **LLM assignment** (Mode 2 only)
- **Negotiation strategy** (per side) + parameters
- **Trash talk intensity** (per side)
- **Stockfish**: grounding mode + skill level
- **Budget** (Mode 2 only): $ cap + warning threshold
- **Save/Load/Share**: named presets + JSON export

---

## 11. Data & Persistence

### 11.1 What's Persisted

- **Games** — move list, config snapshot, outcome
- **Transcripts** — every statement, reasoning, timestamp
- **Costs** (Mode 2) — tokens and $ per agent
- **Personalities** — user-saved customs
- **Highlights** — flagged moments

### 11.2 Live State File

`state/game_state.json` updated after every phase. This is the single source of truth consumed by both UIs.

### 11.3 Replay

Scrubbable turn-by-turn playback with full transcripts. No new LLM calls during replay.

### 11.4 Share

Replay links + auto-generated 3–5 moment highlight reel.

---

## 12. Cost Management

### 12.1 Mode 1

- Token cost: **$0** for subscribers.
- Bounded by plan message limits. Pro users should prefer short strategies (democracy, auction) on long games. Max users have plenty of headroom.
- No cost tracking UI needed; a simple "sub-agent invocations this game" counter suffices.

### 12.2 Mode 2

- Per-game $ counter always visible
- Per-agent breakdown in post-game report
- Estimates shown before game start based on model picks
- Hard cap with early termination + "ran out of budget" narration
- Soft warning at 75%
- Rough targets:
  - Budget config: <$0.50/game
  - Default config: $2–5/game
  - Premium config: $10–30/game

### 12.3 Cost Reduction (Mode 2)

- Prompt caching (Anthropic + OpenAI both support it — not optional, implement from day one)
- Shared per-turn context computed once, not per agent
- Model tiering (cheap models for minor agents)
- Skip abstentions
- Early debate termination on consensus

---

## 13. Non-Functional Requirements

- **Latency**: default-config turn resolves in <60s. Streaming starts <2s after turn begin.
- **Reliability**: provider/sub-agent failure never crashes the game. Abstain or fall back.
- **Observability**: every LLM invocation logged (inputs, outputs, latency, cost). Mode 2 integrates LangSmith/Langfuse. Mode 1 logs to local transcript file.
- **Security**: API keys (Mode 2) never leave backend. CORS locked. JSON schema validation on all agent output.
- **Accessibility**: keyboard nav, screen reader support on negotiation panel.
- **Mobile**: responsive, spectator-first on phone.

---

## 14. Implementation Phases

### Phase 1 — Claude Code MVP

Goal: `/loop start` produces a watchable AI vs AI game in the terminal.

- Mode 1 only
- Grouped topology
- One strategy: **auction** (lowest overhead, most fun)
- One personality preset: **Medieval Serious**
- Stockfish Advisory mode
- Terminal UI only
- `.claude/commands/loop.md` + `.claude/agents/chess-agent.md` + core engine
- No persistence beyond transcript append
- Runs end-to-end in a single Claude Code session

### Phase 2 — Strategies & Personalities

- All 9 negotiation strategies
- 3+ personality presets
- Trash talk system (kill lines, intensity control)
- YAML config loader
- `/game-new`, `/game-pause`, `/game-resume`, `/game-status`, `/game-highlights`

### Phase 3 — Web UI for Mode 1

- Static `ui/static/` reading `game_state.json`
- Full animated board, agent cards, negotiation panel
- Highlight reel post-game
- Replay scrubber

### Phase 4 — Mode 2 (API-Direct)

- `LiteLLMExecutor` implementation
- FastAPI + WebSocket backend
- Multi-provider config UI
- Cost tracking + prompt caching
- Full Mode 1 feature parity

### Phase 5 — Stretch

- Individual topology (16 agents/side)
- Voice synthesis per piece (TTS)
- Twitch/YouTube live-stream mode
- Tournament bracket mode
- Cross-game memory
- Spectator chat integration
- Post-game AI commentator

---

## 15. Open Questions

1. **Streaming granularity.** Token-level streaming is Mode 2 native but requires polling tricks in Mode 1. How cinematic do we need the per-letter effect to be?
2. **Illegal move handling.** LLMs occasionally propose illegal moves. Options: reject + re-prompt, fall back to random legal, fall back to Stockfish top-1. Default: re-prompt once, then Stockfish fallback.
3. **Draw handling.** Standard rules, or let the two King agents negotiate draw offers? (The latter is funnier.)
4. **Personality leakage.** Do agents see opposing personalities, or must they be inferred from trash talk?
5. **Context rollup cadence (Mode 1).** Orchestrator context grows every turn. When do we summarize? Every 10 turns? Every 20?

---

## 16. Success Criteria

- A random friend watches a full game and laughs at least three times.
- The project runs end-to-end from a fresh Claude Code clone with one command: `/loop start`.
- Zero API keys required for the default experience.
- Swapping executors (Mode 1 ↔ Mode 2) requires changing only the config — no application code.
- A single YAML file fully specifies a reproducible game.
- A 10-second highlight clip from any game is postable without explanation.
- The most-used negotiation strategy after a week of user testing is *not* the one you expected.

---

## Appendix A — Example `.claude/commands/loop.md`

```markdown
---
description: Run the Chess of Minds game loop — spawns piece-agents, negotiates, plays moves
argument-hint: "[start | next | auto | pause | resume | stop | status] [config.yaml]"
---

You are the orchestrator for Chess of Minds — a chess game where every piece is an AI sub-agent.

## Your job

Based on the user's argument (`$ARGUMENTS`), drive the game forward:

- `start [config_path]` — initialize a new game from the config file (default: `configs/active.yaml`). Write initial `state/game_state.json`. Then fall through to `next`.
- `next` — advance exactly one turn.
- `auto` — run continuously. After each turn, check `state/game_state.json` for `paused: true` or game over; otherwise continue.
- `pause` — set `paused: true` in state. Do nothing else.
- `resume` — unset pause, fall through to `auto`.
- `stop` — write final transcript, terminate.
- `status` — print current board, turn, strategy, recent events.

## Per-turn procedure

1. Read `state/game_state.json` and `configs/active.yaml`.
2. Compute turn brief: FEN, ASCII board, legal moves per piece-agent, Stockfish eval (if grounding enabled).
3. **Spawn piece-agents in parallel.** For each agent on the side to move, invoke the `chess-agent` sub-agent with:
   - Role (pawn/knight/bishop/rook/queen/king)
   - Personality (from config)
   - Turn context (brief + memory summary)
   - Negotiation phase ("proposal" / "debate round N" / "final vote")
4. Collect JSON proposals. Validate against the proposal schema.
5. Run the configured negotiation strategy (see `engine/negotiation/*.py` for logic).
6. Resolve to a single legal move. If the winning proposal is illegal, re-prompt that agent once; if still illegal, fall back to Stockfish top-1.
7. Play the move via `python-chess`. Append to `state/transcript.md`. Update `state/game_state.json`.
8. Spawn 1–2 reaction sub-agents (capturing piece + captured piece, if applicable).
9. Print the formatted turn summary (use the format in Section 4.6 of the PRD).
10. If game over, write final state and stop. If paused, stop. Otherwise continue if in `auto`.

## Parallelism

Spawn all piece-agents for a phase in a single message via multiple Task tool calls. Do NOT spawn sequentially.

## Sub-agent invocation template

When calling the `chess-agent` sub-agent, pass a prompt structured as:

- Role: {role}
- Personality: {traits, style, relationships}
- Board FEN: {fen}
- ASCII board: {ascii_board}
- Legal moves for your pieces: {moves}
- Stockfish analysis: {analysis or "disabled"}
- Recent events: {memory_summary}
- Teammate proposals this round: {proposals or "[none yet]"}
- Instruction: "Respond with a JSON object matching the ProposalSchema."

## Output format

After each turn, print the formatted turn summary to the user. Be concise in prose between turns — the formatted summary carries the content.
```

---

## Appendix B — Example `.claude/agents/chess-agent.md`

```markdown
---
name: chess-agent
description: A single chess piece-agent in the Chess of Minds game. Adopts a role + personality, evaluates the board, and proposes a move with in-character reasoning and trash talk.
tools: []
---

You are a chess piece-agent. Your role, personality, and current situation are supplied in each invocation.

## Hard rules

- Stay ruthlessly in character per the personality passed in.
- Respond with a single JSON object, no prose around it.
- Your proposed_move must be one of the legal moves listed. If unsure, abstain.
- Your public_statement and trash_talk are 1–3 sentences each, max.
- Your reasoning is 1–3 sentences, max.
- Do not exceed 500 output tokens total.

## Response schema

{
  "proposed_move": "<UCI move string or 'abstain'>",
  "reasoning": "<strategic thinking, 1-3 sentences>",
  "public_statement": "<in-character line, 1-3 sentences>",
  "confidence": <integer 0-100>,
  "trash_talk": "<optional, directed at an opponent piece>"
}

## Guidance

- If Stockfish analysis is provided, weight it seriously but do not blindly obey — your personality can prefer flashier or safer moves.
- In debate rounds, read teammates' prior proposals and either align or argue against them.
- Trash talk is in-character. A stoic king doesn't shit-talk; a sarcastic rook might.
- Confidence reflects both chess strength of the move and your personality's own bravado.

Respond with only the JSON.
```

---

## Appendix C — Example Config (YAML)

```yaml
execution:
  mode: claude_code_subagents      # or 'litellm_api'

game:
  mode: ai_vs_ai
  max_turns: 150
  time_per_turn_s: 45              # Mode 2 only

white:
  topology: grouped
  personality_preset: shakespearean_tragedy
  trash_talk_intensity: spicy
  negotiation:
    strategy: debate
    params:
      rounds: 3
      stockfish_mode: advisory
  # agents.* is ignored in Mode 1 (all agents are Claude via sub-agents)
  agents:
    king:    { provider: anthropic, model: claude-opus-4-7 }
    queen:   { provider: anthropic, model: claude-sonnet-4-6 }
    rooks:   { provider: openai,    model: gpt-4o }
    bishops: { provider: xai,       model: grok-beta }
    knights: { provider: openai,    model: gpt-4o-mini }
    pawns:   { provider: groq,      model: llama-3.3-70b }

black:
  topology: grouped
  personality_preset: modern_office
  trash_talk_intensity: unhinged
  negotiation:
    strategy: auction
    params:
      stockfish_mode: required

budget:
  max_cost_usd: 5.00               # Mode 2 only
  warn_at_pct: 75
```

---

## Appendix D — Glossary

- **Agent** — an AI actor representing one or more chess pieces
- **Brief** — structured context passed to all agents at turn start
- **Executor** — the layer that turns agent calls into either Claude Code sub-agent spawns (Mode 1) or LiteLLM API calls (Mode 2)
- **Grounding** — consulting a real chess engine to avoid hallucinated tactics
- **Negotiation strategy** — the protocol for converging on a single move
- **Rivalry** — tracked antagonism between two specific pieces, unlocks special trash-talk prompts
- **Sub-agent** — a Claude instance spawned by the main Claude Code session via the Task tool
- **Topology** — how pieces are grouped into agents (Grouped vs Individual)