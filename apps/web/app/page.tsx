import { CopyableCommand } from "@/components/CopyableCommand";
import { TurnFlow } from "@/components/TurnFlow";
import { CastGrid } from "@/components/CastGrid";
import { StrategyGrid } from "@/components/StrategyGrid";
import { LandingBoard } from "@/components/LandingBoard";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://chessminds-psi.vercel.app";
const PROMPT = `Use ${SITE_URL}/play.md to start a chess game`;

const ITALIAN = "rnbqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-[100svh] max-w-4xl flex-col gap-24 px-6 py-12 sm:px-8 sm:py-20">
      <header className="flex items-center justify-between text-sm">
        <span className="font-serif-display text-base">Chess of Minds</span>
        <nav className="flex gap-5 text-ink/60 dark:text-paper/60">
          <a href="/play.md" className="hover:text-ink dark:hover:text-paper">
            /play.md
          </a>
          <a href="/llms.txt" className="hover:text-ink dark:hover:text-paper">
            /llms.txt
          </a>
          <a
            href="https://github.com/anoopawscloud/colabchess"
            className="hover:text-ink dark:hover:text-paper"
          >
            GitHub
          </a>
        </nav>
      </header>

      {/* ─── Hero ──────────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div className="flex flex-col gap-6">
          <span className="text-xs uppercase tracking-[0.24em] text-ember">
            Chess · reimagined
          </span>
          <h1 className="font-serif-display text-5xl leading-[1.02] tracking-tight sm:text-6xl">
            Chess, played by
            <br />
            <span className="text-ember">twelve</span> minds.
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-ink/70 dark:text-paper/70">
            Six AI agents per side — one per piece-type — each with their own
            personality, voice, and opinions about the position. They propose,
            argue, and negotiate every move. The point isn&rsquo;t to play
            perfect chess; it&rsquo;s to watch minds collide.
          </p>

          <div className="flex flex-col gap-3 pt-2">
            <span className="text-xs uppercase tracking-[0.18em] text-ink/50 dark:text-paper/50">
              Paste this into Claude Code
            </span>
            <CopyableCommand command={PROMPT} />
            <p className="text-xs text-ink/50 dark:text-paper/50">
              Your Claude Code session does all the AI work. No API keys, no
              accounts. Free for Pro/Max subscribers at the token level.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4">
          <LandingBoard fen={ITALIAN} size={320} id="hero-board" />
          <div className="flex flex-col items-center gap-1 text-center text-xs text-ink/50 dark:text-paper/50">
            <span className="font-mono-block">Italian Game after 4.Bc4</span>
            <span>
              Imagine six voices arguing about what white plays next.
            </span>
          </div>
        </div>
      </section>

      {/* ─── Why we made this ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-6 rounded-2xl border border-ink/10 bg-paper/50 p-8 dark:border-paper/10 dark:bg-ink/30 sm:p-10">
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.2em] text-ink/50 dark:text-paper/50">
            Why this exists
          </span>
          <h2 className="font-serif-display text-3xl leading-tight tracking-tight sm:text-4xl">
            An experiment in watching AI agents decide.
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <WhyCard
            ordinal="01"
            title="Multi-agent coordination, as spectacle."
            body="Chess is minds colliding. We split one mind into six per side and watched them try to agree. The arguments are more interesting than the chess."
          />
          <WhyCard
            ordinal="02"
            title="Strategies are a design space."
            body="Auction, democracy, monarchy, debate, consensus, hierarchy — each produces a different game from the same position. This is collective-decision theory you can watch in 60 seconds."
          />
          <WhyCard
            ordinal="03"
            title="Agent-native UX."
            body="You point your coding-agent at one markdown URL and it runs the whole game locally. No accounts, no keys, no install. It&rsquo;s a demonstration of what apps look like when agents are the runtime."
          />
        </div>
      </section>

      {/* ─── One turn, unpacked (the core explainer) ───────────────────────── */}
      <TurnFlow />

      {/* ─── The cast ─────────────────────────────────────────────────────── */}
      <CastGrid />

      {/* ─── Strategies ───────────────────────────────────────────────────── */}
      <StrategyGrid />

      {/* ─── How it works (technical, brief) ───────────────────────────────── */}
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.2em] text-ink/50 dark:text-paper/50">
            The stack
          </span>
          <h2 className="font-serif-display text-3xl leading-tight tracking-tight sm:text-4xl">
            Three layers, narrow roles.
          </h2>
        </div>
        <ol className="flex flex-col gap-4 sm:flex-row sm:gap-6">
          <StackStep
            n={1}
            label="Your Claude Code"
            body="Fetches /play.md, creates a game, spawns piece-agent sub-agents per turn, runs the negotiation locally, POSTs moves. Every LLM call happens here — so it costs you nothing on Pro/Max."
            accent="text-ember"
          />
          <StackStep
            n={2}
            label="AWS backend"
            body="A stateless relay on Lambda + DynamoDB. Validates moves with python-chess, stores the event log, serves the snapshot. Never calls an LLM."
            accent="text-indigo-600 dark:text-indigo-400"
          />
          <StackStep
            n={3}
            label="This browser"
            body="Next.js + react-chessboard. Polls the API every 1.5s. Renders the board, the twelve agent cards, and the turn-by-turn negotiation feed."
            accent="text-emerald-700 dark:text-emerald-400"
          />
        </ol>
      </section>

      {/* ─── Footer ───────────────────────────────────────────────────────── */}
      <footer className="mt-auto flex flex-col gap-3 border-t border-ink/10 pt-8 text-xs text-ink/50 dark:border-paper/10 dark:text-paper/50 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Made on Earth, 2026. Open source. No license yet — don&rsquo;t ship
          your own games on top until there is one.
        </span>
        <div className="flex gap-4">
          <a
            href="https://github.com/anoopawscloud/colabchess"
            className="hover:text-ink dark:hover:text-paper"
          >
            GitHub
          </a>
          <a href="/llms.txt" className="hover:text-ink dark:hover:text-paper">
            /llms.txt
          </a>
          <a href="/play.md" className="hover:text-ink dark:hover:text-paper">
            /play.md
          </a>
        </div>
      </footer>
    </main>
  );
}

function WhyCard({
  ordinal,
  title,
  body,
}: {
  ordinal: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono-block text-xs text-ember">{ordinal}</span>
      <h3 className="font-serif-display text-lg leading-snug">{title}</h3>
      <p className="text-sm leading-relaxed text-ink/70 dark:text-paper/70">
        {body}
      </p>
    </div>
  );
}

function StackStep({
  n,
  label,
  body,
  accent,
}: {
  n: number;
  label: string;
  body: string;
  accent: string;
}) {
  return (
    <li className="flex flex-1 flex-col gap-2 rounded-xl border border-ink/10 bg-paper/60 p-5 dark:border-paper/10 dark:bg-ink/40">
      <div className="flex items-baseline gap-3">
        <span className={`font-mono-block text-lg ${accent}`}>
          {String(n).padStart(2, "0")}
        </span>
        <span className="font-serif-display text-lg">{label}</span>
      </div>
      <p className="text-sm leading-relaxed text-ink/70 dark:text-paper/70">
        {body}
      </p>
    </li>
  );
}
