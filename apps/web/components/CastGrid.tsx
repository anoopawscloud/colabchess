const CAST = [
  {
    glyph: "♚",
    role: "King",
    accent: "text-amber-600 dark:text-amber-400",
    trait: "Cautious · self-preserving",
    summary:
      "Prefers defensive moves. Knows that their death ends the game. In monarchy mode, they pick the winner from the others' proposals.",
  },
  {
    glyph: "♛",
    role: "Queen",
    accent: "text-rose-600 dark:text-rose-400",
    trait: "Decisive · often overconfident",
    summary:
      "The most powerful piece, and they know it. Tend to propose sharp attacking moves with high confidence, sometimes prematurely.",
  },
  {
    glyph: "♜",
    role: "Rooks",
    accent: "text-stone-700 dark:text-stone-300",
    trait: "Stoic · structural",
    summary:
      "See the game in ranks and files. Advocate for open files, doubled rooks, and the seventh rank. Rarely speak first.",
  },
  {
    glyph: "♝",
    role: "Bishops",
    accent: "text-indigo-600 dark:text-indigo-400",
    trait: "Scheming · patient",
    summary:
      "Diagonal thinkers. Fond of long-term pins, fianchettos, and quietly menacing moves. Often carry grudges across turns.",
  },
  {
    glyph: "♞",
    role: "Knights",
    accent: "text-emerald-700 dark:text-emerald-400",
    trait: "Glory-seeking · tactical",
    summary:
      "Jumpy, optimistic, see forks where none exist. Propose aggressive outposts and sacrificial charges with high confidence.",
  },
  {
    glyph: "♟",
    role: "Pawns",
    accent: "text-sky-700 dark:text-sky-400",
    trait: "Loyal · forward-marching",
    summary:
      "Eight voices, one agent. Strongly biased toward pushing pawns. Speak collectively; know one of them will be sacrificed soon.",
  },
];

export function CastGrid() {
  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.2em] text-ink/50 dark:text-paper/50">
          The cast
        </span>
        <h2 className="font-serif-display text-4xl leading-tight tracking-tight sm:text-5xl">
          Six agents per side.
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-ink/70 dark:text-paper/70">
          Each piece-type is one agent. The <em>Pawns</em> agent speaks for all
          eight pawns at once; the <em>Knights</em> agent for both knights.
          Their personalities come from the preset. This is <em>medieval
          serious</em>, the default. Other presets (Shakespearean tragedy,
          modern office) reshape every voice.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAST.map((c) => (
          <li
            key={c.role}
            className="flex gap-4 rounded-xl border border-ink/10 bg-paper/60 p-5 dark:border-paper/10 dark:bg-ink/40"
          >
            <span className={`text-5xl leading-none ${c.accent}`}>{c.glyph}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-serif-display text-xl">{c.role}</span>
              <span className="font-mono-block text-[10px] uppercase tracking-[0.14em] text-ink/50 dark:text-paper/50">
                {c.trait}
              </span>
              <p className="mt-1 text-sm text-ink/70 dark:text-paper/70">
                {c.summary}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
