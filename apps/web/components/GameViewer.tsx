"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Chessboard } from "react-chessboard";
import {
  ROLES,
  ROLE_GLYPH,
  ROLE_LABEL,
  ROLE_ACCENT,
  type Role,
  isRole,
} from "@/lib/agents";
import type { BaseEvent, Snapshot } from "@/lib/types";
import { isMoveType, normalizeMove, normalizeProposal } from "@/lib/events";
import { groupIntoTurns, auctionWinner, type Turn } from "@/lib/turns";
import { NegotiationBars, type BarDatum } from "./NegotiationBars";

type Side = "white" | "black";
type ConnState = "connecting" | "live" | "error";

interface AgentState {
  role: Role;
  side: Side;
  lastStatement: string | null;
  lastProposedMove: string | null;
  lastConfidence: number | null;
  status: "idle" | "thinking" | "proposed" | "done";
}

function emptyAgents(): Record<Side, Record<Role, AgentState>> {
  const make = (side: Side): Record<Role, AgentState> =>
    Object.fromEntries(
      ROLES.map((role) => [
        role,
        {
          role,
          side,
          lastStatement: null,
          lastProposedMove: null,
          lastConfidence: null,
          status: "idle" as const,
        },
      ]),
    ) as Record<Role, AgentState>;
  return { white: make("white"), black: make("black") };
}

function deriveAgents(events: BaseEvent[]): Record<Side, Record<Role, AgentState>> {
  const out = emptyAgents();
  for (const e of events) {
    if (e.type === "PROPOSAL") {
      const p = normalizeProposal(e);
      if ((p.side === "white" || p.side === "black") && isRole(p.role)) {
        out[p.side][p.role] = {
          role: p.role,
          side: p.side,
          lastStatement: p.publicStatement || null,
          lastProposedMove: p.move || null,
          lastConfidence: p.confidence,
          status: "proposed",
        };
      }
    } else if (e.type === "REACTION") {
      const side = (e as Record<string, unknown>).side as Side;
      const agent = (((e as Record<string, unknown>).agent ??
        (e as Record<string, unknown>).group) as string) || "";
      if ((side === "white" || side === "black") && isRole(agent)) {
        out[side][agent].lastStatement =
          ((e as Record<string, unknown>).public_statement as string) ??
          out[side][agent].lastStatement;
      }
    } else if (isMoveType(e.type)) {
      for (const r of ROLES) {
        out.white[r].status =
          out.white[r].status === "proposed" ? "done" : out.white[r].status;
        out.black[r].status =
          out.black[r].status === "proposed" ? "done" : out.black[r].status;
      }
    } else if (e.type === "TURN_STARTED") {
      const side = (e as Record<string, unknown>).side as Side;
      if (side === "white" || side === "black") {
        for (const r of ROLES) out[side][r].status = "thinking";
      }
    }
  }
  return out;
}

function sideToMove(fen: string): Side {
  return fen.split(" ")[1] === "w" ? "white" : "black";
}

function turnNumber(fen: string): number {
  const parts = fen.split(" ");
  return parseInt(parts[5] ?? "1", 10);
}

export function GameViewer({
  initial,
  apiBase,
}: {
  initial: Snapshot;
  apiBase: string;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [events, setEvents] = useState<BaseEvent[]>(initial.events ?? []);
  const [cursor, setCursor] = useState<number>(initial.next_seq ?? 0);
  const [polling, setPolling] = useState(true);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const timelineRef = useRef<HTMLDivElement>(null);
  const lastTurnCountRef = useRef(0);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(
          `${apiBase}/games/${initial.id}/events?since=${cursor}`,
          { cache: "no-store" },
        );
        if (!r.ok) throw new Error(`API ${r.status}`);
        const data = (await r.json()) as {
          events: BaseEvent[];
          next_seq: number;
          status: string;
        };
        if (cancelled) return;
        setConn("live");
        setLastError(null);
        if (data.events?.length) {
          setEvents((prev) => [...prev, ...data.events]);
          setCursor(data.next_seq);
          const lastMove = [...data.events].reverse().find((e) => e.type === "MOVE");
          if (lastMove && (lastMove as Record<string, unknown>).fen_after) {
            setSnapshot((s) => ({
              ...s,
              fen: (lastMove as Record<string, unknown>).fen_after as string,
              status: data.status,
            }));
          } else if (data.status !== snapshot.status) {
            setSnapshot((s) => ({ ...s, status: data.status }));
          }
          if (data.status && data.status !== "ongoing") setPolling(false);
        }
      } catch (err) {
        if (cancelled) return;
        setConn("error");
        const msg = err instanceof Error ? err.message : "unknown error";
        setLastError(msg);
        console.error("[chessminds] poll failed:", err);
      }
    };
    const id = setInterval(tick, 1500);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiBase, cursor, initial.id, polling, snapshot.status]);

  const grouped = useMemo(() => groupIntoTurns(events), [events]);
  const agents = useMemo(() => deriveAgents(events), [events]);
  const toMove = sideToMove(snapshot.fen);
  const turn = turnNumber(snapshot.fen);
  const ended = snapshot.status !== "ongoing";

  // When a new turn arrives, scroll the timeline to the bottom. We don't scroll
  // on in-progress updates to the current turn; that would yank the user's view
  // away from what they're reading.
  useEffect(() => {
    if (grouped.turns.length > lastTurnCountRef.current) {
      lastTurnCountRef.current = grouped.turns.length;
      timelineRef.current?.scrollTo({
        top: timelineRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [grouped.turns.length]);

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-[1400px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-serif-display text-base">Chess of Minds</span>
          <span className="font-mono-block text-xs text-ink/40 dark:text-paper/40">
            {initial.id}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <StatusPill status={snapshot.status} toMove={toMove} />
          <ConnPill state={conn} error={lastError} />
          <span className="font-mono-block text-ink/50 dark:text-paper/50">
            turn {turn}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        <section className="flex-1 grid grid-cols-1 gap-4 md:grid-cols-[minmax(230px,260px)_minmax(0,1fr)_minmax(230px,260px)] md:gap-5">
          <AgentColumn side="black" agents={agents.black} active={toMove === "black" && !ended} />
          <div className="mx-auto flex w-full max-w-[600px] flex-col gap-3">
            <div className="overflow-hidden rounded-xl border border-ink/10 shadow-sm dark:border-paper/10">
              <Chessboard
                options={{
                  position: snapshot.fen,
                  allowDragging: false,
                  boardOrientation: "white",
                  id: `cm-${initial.id}`,
                }}
              />
            </div>
            <span className="truncate text-center font-mono-block text-[11px] text-ink/50 dark:text-paper/50">
              {snapshot.fen}
            </span>
          </div>
          <AgentColumn side="white" agents={agents.white} active={toMove === "white" && !ended} />
        </section>

        <aside
          className={`flex flex-col overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.02] transition-[width] duration-300 dark:border-paper/10 dark:bg-paper/[0.02] lg:self-stretch ${
            timelineOpen ? "lg:w-[380px]" : "lg:w-[48px]"
          }`}
        >
          <TimelineHeader
            open={timelineOpen}
            onToggle={() => setTimelineOpen((v) => !v)}
            turnCount={grouped.turns.length}
            eventCount={events.length}
          />
          <div
            ref={timelineRef}
            className={`flex flex-col gap-3 overflow-y-auto px-4 pb-4 lg:flex-1 ${
              timelineOpen ? "" : "hidden lg:hidden"
            }`}
          >
            {grouped.opening && <OpeningBanner event={grouped.opening} />}
            {grouped.turns.length === 0 && !grouped.opening && (
              <p className="py-8 text-center text-sm text-ink/50 dark:text-paper/50">
                Waiting for the first event…
              </p>
            )}
            <AnimatePresence initial={false}>
              {grouped.turns.map((t) => (
                <TurnCard key={t.key} turn={t} />
              ))}
            </AnimatePresence>
            {grouped.gameOver && <GameOverBanner event={grouped.gameOver} />}
          </div>
          {!timelineOpen && (
            <div className="hidden flex-1 items-center justify-center lg:flex">
              <span
                className="font-mono-block text-[11px] uppercase tracking-[0.18em] text-ink/40 dark:text-paper/40"
                style={{ writingMode: "vertical-rl" }}
              >
                Timeline
              </span>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function TimelineHeader({
  open,
  onToggle,
  turnCount,
  eventCount,
}: {
  open: boolean;
  onToggle: () => void;
  turnCount: number;
  eventCount: number;
}) {
  return (
    <div
      className={`flex items-center gap-2 border-b border-ink/10 px-4 py-3 dark:border-paper/10 ${
        open ? "justify-between" : "justify-center"
      }`}
    >
      {open && (
        <div className="flex flex-col">
          <span className="font-mono-block text-[10px] uppercase tracking-[0.18em] text-ink/50 dark:text-paper/50">
            Timeline
          </span>
          <span className="font-mono-block text-[10px] text-ink/40 dark:text-paper/40">
            {turnCount} turn{turnCount === 1 ? "" : "s"} · {eventCount} event
            {eventCount === 1 ? "" : "s"}
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? "Collapse timeline" : "Expand timeline"}
        className="hidden rounded-md border border-ink/10 p-1.5 text-ink/50 transition hover:border-ember hover:text-ember dark:border-paper/10 dark:text-paper/50 lg:inline-flex"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          className={`transition-transform ${open ? "" : "rotate-180"}`}
          aria-hidden
        >
          <path
            d="M12 4l-6 6 6 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

// ─── Header sub-components ─────────────────────────────────────────────────────

function StatusPill({ status, toMove }: { status: string; toMove: Side }) {
  if (status === "ongoing") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-ember/10 px-3 py-1 font-mono-block text-[11px] uppercase tracking-[0.14em] text-ember">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ember" />
        live · {toMove} to move
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-ink/10 px-3 py-1 font-mono-block text-[11px] uppercase tracking-[0.14em] text-ink dark:bg-paper/10 dark:text-paper">
      {status}
    </span>
  );
}

function ConnPill({ state, error }: { state: ConnState; error: string | null }) {
  if (state === "live") return null;
  const bg =
    state === "error"
      ? "bg-rose-500/10 text-rose-600"
      : "bg-ink/10 text-ink/60 dark:bg-paper/10 dark:text-paper/60";
  return (
    <span
      className={`font-mono-block ${bg} rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.14em]`}
      title={error ?? ""}
    >
      {state === "error" ? "conn error" : "connecting"}
    </span>
  );
}

// ─── Agent cards (side columns) ────────────────────────────────────────────────

function AgentColumn({
  side,
  agents,
  active,
}: {
  side: Side;
  agents: Record<Role, AgentState>;
  active: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="font-serif-display text-sm uppercase tracking-[0.2em]">
          {side}
        </span>
        {active && (
          <span className="font-mono-block text-[11px] text-ember">to move</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {ROLES.map((role) => (
          <AgentCard key={role} agent={agents[role]} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentState }) {
  const accent = ROLE_ACCENT[agent.role];
  return (
    <motion.div
      layout
      className="rounded-lg border border-ink/10 bg-paper/60 p-3 dark:border-paper/10 dark:bg-ink/60"
    >
      <div className="flex items-start gap-3">
        <span className={`text-2xl leading-none ${accent}`}>
          {ROLE_GLYPH[agent.role]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-serif-display text-base leading-none">
              {ROLE_LABEL[agent.role]}
            </span>
            {agent.lastConfidence !== null && (
              <span className="font-mono-block text-[10px] text-ink/40 dark:text-paper/40">
                conf {agent.lastConfidence}
              </span>
            )}
          </div>
          {agent.lastProposedMove && (
            <span className="mt-0.5 block font-mono-block text-[10px] text-ink/40 dark:text-paper/40">
              → {agent.lastProposedMove}
            </span>
          )}
          {agent.lastStatement ? (
            <p className="mt-1.5 text-[13px] leading-snug text-ink/70 dark:text-paper/70">
              &ldquo;{agent.lastStatement}&rdquo;
            </p>
          ) : (
            <p className="mt-1.5 text-xs italic text-ink/40 dark:text-paper/40">
              {agent.status === "thinking" ? "thinking…" : "yet to speak"}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Turn cards ────────────────────────────────────────────────────────────────

function OpeningBanner({ event }: { event: BaseEvent }) {
  const cfg = (event as Record<string, unknown>).config as
    | Record<string, unknown>
    | undefined;
  const white =
    (cfg?.white as Record<string, unknown> | undefined)?.negotiation_strategy ??
    "auction";
  const black =
    (cfg?.black as Record<string, unknown> | undefined)?.negotiation_strategy ??
    "auction";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-lg border border-ink/10 bg-paper p-3 text-xs text-ink/60 dark:border-paper/10 dark:bg-ink dark:text-paper/60"
    >
      <span className="font-serif-display text-sm text-ink dark:text-paper">
        Game begins.
      </span>{" "}
      White: {String(white)} · Black: {String(black)}
    </motion.div>
  );
}

function GameOverBanner({ event }: { event: BaseEvent }) {
  const e = event as Record<string, unknown>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border-2 border-ember bg-ember/10 p-4 text-center"
    >
      <span className="font-mono-block text-[11px] uppercase tracking-[0.18em] text-ember">
        Game over
      </span>
      <p className="mt-2 font-serif-display text-xl">
        🏁 <span className="capitalize">{e.winner as string}</span>{" "}
        wins by {e.reason as string}
      </p>
    </motion.div>
  );
}

function TurnCard({ turn }: { turn: Turn }) {
  const winnerRole = auctionWinner(turn.result);
  const resultMove =
    ((turn.result as Record<string, unknown> | undefined)?.move as string) ?? null;
  const phase = !turn.complete
    ? turn.result
      ? "deciding"
      : turn.proposals.length > 0
        ? "proposals in"
        : "waiting"
    : "resolved";

  const sideColor = turn.side === "white" ? "text-ink dark:text-paper" : "text-ink/70 dark:text-paper/70";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-ink/10 bg-paper/80 shadow-sm dark:border-paper/10 dark:bg-ink/60"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/10 px-4 py-3 dark:border-paper/10">
        <div className="flex items-baseline gap-3">
          <span className="font-mono-block text-[11px] uppercase tracking-[0.18em] text-ink/40 dark:text-paper/40">
            Turn {turn.turn}
          </span>
          <span className={`font-serif-display text-lg capitalize ${sideColor}`}>
            {turn.side ?? "—"}
          </span>
        </div>
        <span
          className={`font-mono-block text-[10px] uppercase tracking-[0.18em] ${
            turn.complete ? "text-ember" : "text-ink/40 dark:text-paper/40"
          }`}
        >
          {phase}
        </span>
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        {/* Phase 1: proposals */}
        {turn.proposals.length > 0 && (
          <section>
            <PhaseLabel>Proposals ({turn.proposals.length})</PhaseLabel>
            <ul className="mt-2 flex flex-col gap-2">
              {turn.proposals.map((e) => {
                const p = normalizeProposal(e);
                const isWinner =
                  winnerRole !== null && p.role === winnerRole;
                return (
                  <ProposalRow
                    key={e.seq}
                    seq={e.seq}
                    role={p.role}
                    move={p.move}
                    confidence={p.confidence}
                    publicStatement={p.publicStatement}
                    trashTalk={p.trashTalk}
                    isWinner={isWinner}
                  />
                );
              })}
            </ul>
          </section>
        )}

        {/* Phase 1.5: negotiation bar chart — visual summary */}
        {turn.proposals.length > 1 && (
          <section>
            <PhaseLabel>Negotiation</PhaseLabel>
            <div className="mt-2">
              <NegotiationBars
                data={turn.proposals.map((e): BarDatum => {
                  const p = normalizeProposal(e);
                  return { role: p.role, confidence: p.confidence, move: p.move };
                })}
                winnerRole={winnerRole}
              />
            </div>
          </section>
        )}

        {/* Phase 2: debate */}
        {turn.debate.length > 0 && (
          <section>
            <PhaseLabel>Debate ({turn.debate.length})</PhaseLabel>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-ink/70 dark:text-paper/70">
              {turn.debate.map((e) => {
                const ev = e as Record<string, unknown>;
                return (
                  <li key={e.seq}>
                    <span className="font-serif-display capitalize">
                      {(ev.agent as string) ?? (ev.group as string) ?? "agent"}
                    </span>
                    : &ldquo;{(ev.public_statement as string) ?? ""}&rdquo;
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Phase 3: decision */}
        {turn.result && (
          <DecisionBanner
            result={turn.result}
            winnerRole={winnerRole}
            resultMove={resultMove}
            proposalCount={turn.proposals.length}
          />
        )}

        {/* Phase 4: move */}
        {turn.move && <MoveResult event={turn.move} />}

        {/* Narration */}
        {turn.narration.length > 0 && (
          <details className="text-xs text-ink/50 dark:text-paper/50">
            <summary className="cursor-pointer select-none font-mono-block text-[10px] uppercase tracking-[0.14em]">
              + {turn.narration.length} narration event
              {turn.narration.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 flex flex-col gap-1 pl-2">
              {turn.narration.map((e) => (
                <li key={e.seq} className="font-mono-block text-[11px]">
                  {String(e.type)}{" "}
                  {(e as Record<string, unknown>).move
                    ? `→ ${String((e as Record<string, unknown>).move)}`
                    : ""}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Phase 5: reactions */}
        {turn.reactions.length > 0 && (
          <section>
            <PhaseLabel>Reactions</PhaseLabel>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {turn.reactions.map((e) => (
                <ReactionRow key={e.seq} event={e} />
              ))}
            </ul>
          </section>
        )}

        {/* Still deliberating */}
        {!turn.complete && !turn.result && turn.proposals.length > 0 && (
          <p className="text-xs italic text-ink/40 dark:text-paper/40">
            The {turn.side} agents are still proposing…
          </p>
        )}
      </div>
    </motion.article>
  );
}

function PhaseLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono-block text-[10px] uppercase tracking-[0.18em] text-ink/40 dark:text-paper/40">
      {children}
    </span>
  );
}

function ProposalRow({
  seq,
  role,
  move,
  confidence,
  publicStatement,
  trashTalk,
  isWinner,
}: {
  seq: number;
  role: string;
  move: string;
  confidence: number | null;
  publicStatement: string;
  trashTalk: string | null;
  isWinner: boolean;
}) {
  const glyph = isRole(role) ? ROLE_GLYPH[role as Role] : "·";
  const accent = isRole(role) ? ROLE_ACCENT[role as Role] : "";
  const label = isRole(role) ? ROLE_LABEL[role as Role] : role || "agent";
  return (
    <li
      className={`rounded-lg border p-3 transition ${
        isWinner
          ? "border-ember/50 bg-ember/5"
          : "border-ink/10 bg-paper dark:border-paper/10 dark:bg-ink/40 opacity-70"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`text-xl leading-none ${accent}`}>{glyph}</span>
        <span className="font-serif-display text-sm">{label}</span>
        {move && (
          <span className="font-mono-block text-[11px] text-ink/50 dark:text-paper/50">
            → {move}
          </span>
        )}
        {confidence !== null && (
          <span
            className={`font-mono-block ml-auto rounded-full px-2 py-0.5 text-[10px] ${
              isWinner
                ? "bg-ember/20 text-ember"
                : "bg-ink/10 text-ink/50 dark:bg-paper/10 dark:text-paper/50"
            }`}
          >
            conf {confidence}
          </span>
        )}
        {isWinner && (
          <span className="font-mono-block rounded-full bg-ember px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] text-paper">
            winner
          </span>
        )}
      </div>
      {publicStatement && (
        <p className="mt-1.5 text-[13px] text-ink/80 dark:text-paper/80">
          &ldquo;{publicStatement}&rdquo;
        </p>
      )}
      {trashTalk && (
        <p className="mt-1 text-xs italic text-ember/90">⚔ {trashTalk}</p>
      )}
      <span className="sr-only">event {seq}</span>
    </li>
  );
}

function DecisionBanner({
  result,
  winnerRole,
  resultMove,
  proposalCount,
}: {
  result: BaseEvent;
  winnerRole: string | null;
  resultMove: string | null;
  proposalCount: number;
}) {
  const strategy = String(result.type).toLowerCase().replace(/_/g, " ");
  const glyph = winnerRole && isRole(winnerRole) ? ROLE_GLYPH[winnerRole as Role] : null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-ink/[0.04] px-3 py-2 text-xs dark:bg-paper/[0.04]">
      <span className="font-mono-block uppercase tracking-[0.14em] text-ink/50 dark:text-paper/50">
        {strategy}
      </span>
      <span className="text-ink/60 dark:text-paper/60">→</span>
      {glyph && <span className="text-lg leading-none">{glyph}</span>}
      <span className="font-serif-display text-sm capitalize">
        {winnerRole ?? "agent"}
      </span>
      {resultMove && (
        <span className="font-mono-block text-ink/60 dark:text-paper/60">
          plays {resultMove}
        </span>
      )}
      {proposalCount > 1 && (
        <span className="font-mono-block ml-auto text-[10px] text-ink/40 dark:text-paper/40">
          out of {proposalCount}
        </span>
      )}
    </div>
  );
}

function MoveResult({ event }: { event: BaseEvent }) {
  const m = normalizeMove(event);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-ember/30 bg-ember/5 px-3 py-2">
      <span className="text-ember">✓</span>
      <span className="font-serif-display text-sm capitalize">{m.side}</span>
      <span className="text-ink/60 dark:text-paper/60">plays</span>
      <span className="font-mono-block text-sm text-ember">
        {m.san ?? m.move}
      </span>
    </div>
  );
}

function ReactionRow({ event }: { event: BaseEvent }) {
  const e = event as Record<string, unknown>;
  if (e.type === "KILL_LINE") {
    return (
      <li className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2">
        <span className="text-rose-600">⚔</span>{" "}
        <strong className="font-serif-display">{e.capturer as string}</strong> vs{" "}
        <strong className="font-serif-display">{e.captured as string}</strong>
        <p className="mt-1 italic text-ink/70 dark:text-paper/70">
          &ldquo;{e.last_words as string}&rdquo;
        </p>
      </li>
    );
  }
  const agent = (e.agent as string) ?? (e.group as string) ?? "";
  const glyph = isRole(agent) ? ROLE_GLYPH[agent as Role] : "·";
  return (
    <li className="text-ink/70 dark:text-paper/70">
      <span className="leading-none">{glyph}</span>{" "}
      <span className="font-serif-display capitalize">{agent}</span>
      : &ldquo;{(e.public_statement as string) ?? ""}&rdquo;
    </li>
  );
}
