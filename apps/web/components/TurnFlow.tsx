import { LandingBoard } from "./LandingBoard";

const STARTING = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

const PROPOSALS = [
  { glyph: "♟", role: "Pawns", move: "e2e4", conf: 88, quote: "We march!" },
  { glyph: "♞", role: "Knights", move: "g1f3", conf: 74, quote: "I ride to f3." },
  { glyph: "♝", role: "Bishops", move: "f1c4", conf: 62, quote: "The Italian diagonal." },
  { glyph: "♜", role: "Rooks", move: "a2a3", conf: 18, quote: "Patience." },
  { glyph: "♛", role: "Queen", move: "d1h5", conf: 35, quote: "Scholar's mate?" },
  { glyph: "♚", role: "King", move: "e1e2", conf: 4, quote: "Please, no." },
];

const MAX_CONF = 88;

export function TurnFlow() {
  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.2em] text-ink/50 dark:text-paper/50">
          One turn, unpacked
        </span>
        <h2 className="font-serif-display text-4xl leading-tight tracking-tight sm:text-5xl">
          How the twelve minds decide each move.
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-ink/70 dark:text-paper/70">
          Chess of Minds replaces one player with six AI agents, each
          responsible for one piece-type (pawns, knights, bishops, rooks,
          queen, king). Every turn they propose, argue, and negotiate a single
          move. Here&rsquo;s the loop.
        </p>
      </div>

      <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Step 1 */}
        <Step index={1} title="Brief" caption="Board → six inboxes">
          <div className="flex items-center justify-center py-2">
            <LandingBoard fen={STARTING} size={180} id="flow-brief" />
          </div>
          <p className="mt-3 text-sm text-ink/70 dark:text-paper/70">
            The current position is sent to every agent on the side to move,
            along with the list of legal moves for <em>their</em> pieces only.
          </p>
        </Step>

        {/* Step 2 */}
        <Step index={2} title="Propose" caption="Six speeches, one round">
          <ul className="flex flex-col gap-2 py-1">
            {PROPOSALS.slice(0, 4).map((p) => (
              <li key={p.role} className="flex items-baseline gap-2">
                <span className="w-6 text-lg leading-none">{p.glyph}</span>
                <span className="font-serif-display text-sm">{p.role}</span>
                <span className="font-mono-block text-[11px] text-ink/50 dark:text-paper/50">
                  {p.move}
                </span>
                <span className="ml-auto font-mono-block text-[10px] text-ink/40 dark:text-paper/40">
                  {p.conf}
                </span>
              </li>
            ))}
            <li className="text-[11px] text-ink/40 dark:text-paper/40">
              + Queen, King
            </li>
          </ul>
          <p className="mt-3 text-sm text-ink/70 dark:text-paper/70">
            Each agent returns a single move plus a confidence score and an
            in-character speech. They also sometimes trash-talk the opponent.
          </p>
        </Step>

        {/* Step 3 */}
        <Step index={3} title="Negotiate" caption="Auction · Debate · Vote · …">
          <ul className="flex flex-col gap-1.5 py-1">
            {PROPOSALS.map((p, i) => {
              const isWinner = i === 0;
              const pct = Math.round((p.conf / MAX_CONF) * 100);
              return (
                <li key={p.role} className="flex items-center gap-2">
                  <span
                    className={`w-5 text-base leading-none ${
                      isWinner ? "" : "opacity-50"
                    }`}
                  >
                    {p.glyph}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10 dark:bg-paper/10">
                    <div
                      className={`h-full rounded-full ${
                        isWinner ? "bg-ember" : "bg-ink/30 dark:bg-paper/30"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-mono-block text-[10px] text-ink/50 dark:text-paper/50">
                    {p.conf}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm text-ink/70 dark:text-paper/70">
            The chosen <em>strategy</em> picks a winner. In auction, the
            highest confidence wins. Other strategies use votes, debate rounds,
            or hierarchy. Different strategies make very different games.
          </p>
        </Step>

        {/* Step 4 */}
        <Step index={4} title="Play" caption="One move, server-validated">
          <div className="flex items-center justify-center py-2">
            <LandingBoard fen={AFTER_E4} size={180} id="flow-play" />
          </div>
          <p className="mt-3 text-sm text-ink/70 dark:text-paper/70">
            The winning move is played against a real chess engine
            (python-chess). If it was illegal, the agent is asked to try again.
            Then the opposing six do the whole thing in reply.
          </p>
        </Step>
      </ol>

      <p className="max-w-3xl text-sm italic text-ink/60 dark:text-paper/60">
        Two sides &times; one deliberation each = one full turn. Repeat until
        checkmate, stalemate, or you hit the turn cap.
      </p>
    </section>
  );
}

function Step({
  index,
  title,
  caption,
  children,
}: {
  index: number;
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-ink/10 bg-paper/60 p-5 dark:border-paper/10 dark:bg-ink/40">
      <header className="flex items-baseline gap-3">
        <span className="font-mono-block text-lg text-ember">
          {String(index).padStart(2, "0")}
        </span>
        <span className="font-serif-display text-xl">{title}</span>
      </header>
      <span className="font-mono-block text-[10px] uppercase tracking-[0.18em] text-ink/40 dark:text-paper/40">
        {caption}
      </span>
      {children}
    </li>
  );
}
