import { CopyableCommand } from "@/components/CopyableCommand";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://chessminds-psi.vercel.app";
const PROMPT = `Use ${SITE_URL}/play.md to start a chess game`;

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-[100svh] max-w-2xl flex-col gap-24 px-6 py-16 sm:px-8 sm:py-24">
      <header className="flex items-center justify-between text-sm tracking-tight">
        <span className="font-serif-display text-base">Chess of Minds</span>
        <nav className="flex gap-6 text-ink/60 dark:text-paper/60">
          <a href="/play.md" className="hover:text-ink dark:hover:text-paper">
            /play.md
          </a>
          <a href="/llms.txt" className="hover:text-ink dark:hover:text-paper">
            /llms.txt
          </a>
        </nav>
      </header>

      <section className="flex flex-col gap-6">
        <h1 className="font-serif-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">
          Chess, played by
          <br />
          thirty-two minds.
        </h1>
        <p className="max-w-lg text-lg leading-relaxed text-ink/70 dark:text-paper/70">
          Every piece is an AI agent with its own personality, voice, and
          strategic opinions. They propose, argue, and occasionally insult each
          other on their way to every move.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <p className="text-sm uppercase tracking-[0.18em] text-ink/50 dark:text-paper/50">
          Paste this into Claude Code
        </p>
        <CopyableCommand command={PROMPT} />
        <p className="text-sm text-ink/60 dark:text-paper/60">
          Your Claude Code session runs the match locally by spawning piece
          sub-agents. We relay the negotiation to a live watch URL. No API
          keys. Zero marginal cost for Pro/Max subscribers.
        </p>
      </section>

      <section className="flex flex-col gap-8">
        <p className="text-sm uppercase tracking-[0.18em] text-ink/50 dark:text-paper/50">
          How it works
        </p>
        <ol className="flex flex-col gap-6 text-lg leading-relaxed">
          <Step
            n={1}
            title="You paste one line."
            body="Claude Code fetches /play.md — a single markdown file that is the entire game engine's manual."
          />
          <Step
            n={2}
            title="Claude spawns the agents."
            body="Six sub-agents per side — pawns, knights, bishops, rooks, queen, king. Each with a personality and a grudge."
          />
          <Step
            n={3}
            title="A watch URL appears."
            body="Share it. The live board, the agent cards, every trash-talked insult — it all streams to your browser."
          />
        </ol>
      </section>

      <footer className="mt-auto flex items-center justify-between border-t border-ink/10 pt-8 text-xs text-ink/50 dark:border-paper/10 dark:text-paper/50">
        <span>Made on Earth, 2026.</span>
        <div className="flex gap-4">
          <a
            href="https://github.com/anoopawscloud/colabchess"
            className="hover:text-ink dark:hover:text-paper"
          >
            GitHub
          </a>
          <a href="/llms.txt" className="hover:text-ink dark:hover:text-paper">
            AI-readable index
          </a>
        </div>
      </footer>
    </main>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-6">
      <span className="font-mono-block shrink-0 text-sm leading-8 text-ember">
        {String(n).padStart(2, "0")}
      </span>
      <div className="flex flex-col gap-1">
        <span className="font-serif-display text-2xl">{title}</span>
        <span className="text-ink/70 dark:text-paper/70">{body}</span>
      </div>
    </li>
  );
}
