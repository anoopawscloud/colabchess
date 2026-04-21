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

type Side = "white" | "black";

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
      const side = (e as any).side as Side;
      const agent = ((e as any).agent ?? (e as any).group) as string;
      if ((side === "white" || side === "black") && isRole(agent)) {
        out[side][agent].lastStatement = (e as any).public_statement ?? out[side][agent].lastStatement;
      }
    } else if (isMoveType(e.type)) {
      for (const r of ROLES) {
        out.white[r].status = out.white[r].status === "proposed" ? "done" : out.white[r].status;
        out.black[r].status = out.black[r].status === "proposed" ? "done" : out.black[r].status;
      }
    } else if (e.type === "TURN_STARTED") {
      const side = (e as any).side as Side;
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

type ConnState = "connecting" | "live" | "error";

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
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(
          `${apiBase}/games/${initial.id}/events?since=${cursor}`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          throw new Error(`API ${r.status}`);
        }
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
        // eslint-disable-next-line no-console
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

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [events.length]);

  const agents = useMemo(() => deriveAgents(events), [events]);
  const toMove = sideToMove(snapshot.fen);
  const turn = turnNumber(snapshot.fen);
  const ended = snapshot.status !== "ongoing";

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-serif-display text-base">Chess of Minds</span>
          <span className="font-mono-block text-xs text-ink/40 dark:text-paper/40">
            {initial.id}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <StatusPill status={snapshot.status} toMove={toMove} />
          <ConnPill state={conn} error={lastError} />
          <span className="font-mono-block text-ink/50 dark:text-paper/50">
            turn {turn}
          </span>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,560px)_1fr]">
        <AgentColumn side="black" agents={agents.black} active={toMove === "black" && !ended} />
        <div className="mx-auto w-full max-w-[560px]">
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
          <div className="mt-3 flex items-center justify-between text-xs text-ink/50 dark:text-paper/50">
            <span className="font-mono-block truncate">{snapshot.fen}</span>
          </div>
        </div>
        <AgentColumn side="white" agents={agents.white} active={toMove === "white" && !ended} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.18em] text-ink/50 dark:text-paper/50">
          Negotiation feed
        </h2>
        <div
          ref={feedRef}
          className="max-h-[420px] overflow-y-auto rounded-xl border border-ink/10 bg-ink/[0.02] px-5 py-4 dark:border-paper/10 dark:bg-paper/[0.02]"
        >
          {events.length === 0 ? (
            <p className="text-sm text-ink/50 dark:text-paper/50">
              Waiting for the first event…
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              <AnimatePresence initial={false}>
                {events.map((e) => (
                  <EventRow key={e.seq} event={e} />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

function ConnPill({ state, error }: { state: ConnState; error: string | null }) {
  if (state === "live") return null;
  const bg = state === "error" ? "bg-rose-500/10 text-rose-600" : "bg-ink/10 text-ink/60 dark:bg-paper/10 dark:text-paper/60";
  return (
    <span
      className={`font-mono-block ${bg} rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.14em]`}
      title={error ?? ""}
    >
      {state === "error" ? `conn error` : "connecting"}
    </span>
  );
}

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
          {agent.lastStatement ? (
            <p className="mt-1 line-clamp-3 text-xs text-ink/70 dark:text-paper/70">
              &ldquo;{agent.lastStatement}&rdquo;
            </p>
          ) : (
            <p className="mt-1 text-xs italic text-ink/40 dark:text-paper/40">
              {agent.status === "thinking" ? "thinking…" : "yet to speak"}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 text-sm"
    >
      {children}
    </motion.li>
  );
}

function Seq({ seq, tone = "muted" }: { seq: number; tone?: "muted" | "ember" | "rose" }) {
  const color =
    tone === "ember"
      ? "text-ember"
      : tone === "rose"
        ? "text-rose-600"
        : "text-ink/40 dark:text-paper/40";
  return (
    <span className={`font-mono-block w-12 shrink-0 text-[11px] ${color}`}>
      {String(seq).padStart(3, "0")}
    </span>
  );
}

function EventRow({ event }: { event: BaseEvent }) {
  if (event.type === "GAME_CREATED") {
    return (
      <Row>
        <Seq seq={event.seq} />
        <span className="italic text-ink/70 dark:text-paper/70">Game begins.</span>
      </Row>
    );
  }

  if (event.type === "TURN_STARTED") {
    const side = ((event as Record<string, unknown>).side as Side) ?? "white";
    return (
      <Row>
        <Seq seq={event.seq} />
        <span className="text-ink/60 dark:text-paper/60">
          Turn {event.turn} · <span className="font-serif-display capitalize">{side}</span>{" "}
          deliberates.
        </span>
      </Row>
    );
  }

  if (event.type === "MOVE") {
    const m = normalizeMove(event);
    return (
      <Row>
        <Seq seq={event.seq} tone="ember" />
        <div className="flex items-center gap-2">
          <span className="text-ember">✓</span>
          <span>
            <span className="font-serif-display capitalize">{m.side}</span> plays{" "}
            <span className="font-mono-block">{m.san ?? m.move}</span>
          </span>
        </div>
      </Row>
    );
  }

  if (event.type === "MOVE_PLAYED") {
    // Non-canonical narration from the orchestrator. Render distinctly so the
    // reader can tell this from the server-written MOVE event.
    const m = normalizeMove(event);
    return (
      <Row>
        <Seq seq={event.seq} />
        <span className="text-ink/50 dark:text-paper/50">
          <span className="font-serif-display capitalize">{m.side}</span> is about to play{" "}
          <span className="font-mono-block">{m.move}</span>…
        </span>
      </Row>
    );
  }

  if (event.type === "PROPOSAL") {
    const p = normalizeProposal(event);
    const glyph = isRole(p.role) ? ROLE_GLYPH[p.role as Role] : "·";
    const accent = isRole(p.role) ? ROLE_ACCENT[p.role as Role] : "";
    const label = isRole(p.role) ? ROLE_LABEL[p.role as Role] : p.role || "agent";
    return (
      <Row>
        <Seq seq={event.seq} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`text-lg leading-none ${accent}`}>{glyph}</span>
            <span className="font-serif-display text-sm capitalize">
              {p.side} {label}
            </span>
            {p.move && (
              <span className="font-mono-block text-[11px] text-ink/40 dark:text-paper/40">
                → {p.move}
              </span>
            )}
            {p.confidence !== null && (
              <span className="font-mono-block text-[10px] text-ink/40 dark:text-paper/40">
                conf {p.confidence}
              </span>
            )}
          </div>
          {p.publicStatement ? (
            <p className="mt-1 text-ink/80 dark:text-paper/80">
              &ldquo;{p.publicStatement}&rdquo;
            </p>
          ) : (
            <p className="mt-1 text-xs italic text-ink/40 dark:text-paper/40">
              (no public statement)
            </p>
          )}
          {p.trashTalk && (
            <p className="mt-1 text-xs italic text-ember">{p.trashTalk}</p>
          )}
        </div>
      </Row>
    );
  }

  if (event.type === "AUCTION_RESULT" || event.type === "VOTE" || event.type === "DEBATE") {
    const e = event as unknown as Record<string, unknown>;
    const winner = (e.winner as string) ?? (e.agent as string) ?? (e.group as string) ?? "";
    const move = (e.move as string) ?? (e.proposed_move as string) ?? "";
    return (
      <Row>
        <Seq seq={event.seq} />
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono-block text-[10px] uppercase tracking-[0.14em] text-ink/40 dark:text-paper/40">
            {event.type.toLowerCase().replace("_", " ")}
          </span>
          {winner && (
            <span className="font-serif-display capitalize">{winner}</span>
          )}
          {move && <span className="font-mono-block text-xs">→ {move}</span>}
        </div>
      </Row>
    );
  }

  if (event.type === "REACTION") {
    const e = event as unknown as Record<string, unknown>;
    const side = (e.side as Side) ?? "white";
    const agent = (e.agent as string) ?? (e.group as string) ?? "";
    const glyph = isRole(agent) ? ROLE_GLYPH[agent as Role] : "·";
    return (
      <Row>
        <Seq seq={event.seq} />
        <div className="flex gap-2">
          <span className="leading-none">{glyph}</span>
          <p className="text-ink/70 dark:text-paper/70">
            <span className="font-serif-display capitalize">
              {side} {agent}
            </span>
            : &ldquo;{(e.public_statement as string) ?? ""}&rdquo;
          </p>
        </div>
      </Row>
    );
  }

  if (event.type === "KILL_LINE") {
    const e = event as unknown as Record<string, unknown>;
    return (
      <Row>
        <Seq seq={event.seq} tone="rose" />
        <div className="flex flex-col gap-0.5 text-sm">
          <span>
            ⚔ <strong>{e.capturer as string}</strong> vs{" "}
            <strong>{e.captured as string}</strong>
          </span>
          <span className="italic text-ink/70 dark:text-paper/70">
            &ldquo;{e.last_words as string}&rdquo;
          </span>
        </div>
      </Row>
    );
  }

  if (event.type === "GAME_OVER") {
    const e = event as unknown as Record<string, unknown>;
    return (
      <Row>
        <Seq seq={event.seq} tone="ember" />
        <span>
          🏁 <strong className="font-serif-display capitalize">{e.winner as string}</strong>{" "}
          wins by {e.reason as string}
        </span>
      </Row>
    );
  }

  // Any other custom event type: render the type + a trimmed JSON snapshot.
  const raw = JSON.stringify(event, null, 0);
  const preview = raw.length > 140 ? raw.slice(0, 140) + "…" : raw;
  return (
    <Row>
      <Seq seq={event.seq} />
      <div className="flex flex-col gap-0.5">
        <span className="font-mono-block text-xs text-ink/60 dark:text-paper/60">
          {event.type}
        </span>
        <span className="font-mono-block text-[10px] text-ink/40 dark:text-paper/40">
          {preview}
        </span>
      </div>
    </Row>
  );
}
