const STRATEGIES = [
  {
    name: "auction",
    tagline: "Highest confidence wins.",
    essay:
      "Fast, punchy turns. The pieces with the strongest conviction win, which rewards bravado as much as chess skill. A good default.",
  },
  {
    name: "democracy",
    tagline: "One vote per agent. Plurality wins.",
    essay:
      "Coalition games emerge. The pawns are numerous but vote as one. The queen is one voice among six. Ties break by auction.",
  },
  {
    name: "monarchy",
    tagline: "The King picks the winner.",
    essay:
      "A second decision round: the King reads all teammates' proposals and picks one (or overrides with a move of their own). Watch the power balance.",
  },
  {
    name: "debate",
    tagline: "N rounds of revision, then auction.",
    essay:
      "After the first round, each agent sees the others' proposals and may change their mind. Minds really do change, which is the point.",
  },
  {
    name: "consensus",
    tagline: "Keep debating until ≥75% agree.",
    essay:
      "Slow, collaborative, occasionally gridlocked. Falls back to auction if it times out. Produces the calmest games and the worst blitz.",
  },
  {
    name: "hierarchy",
    tagline: "Queen > Rooks > Bishops > Knights > Pawns.",
    essay:
      "Top-down: if the queen proposed, the queen wins. If not, the highest-ranking proposer. Deliberate authoritarianism, sometimes brilliant.",
  },
  {
    name: "rotating",
    tagline: "A different piece-type has sole authority each turn.",
    essay:
      "Turn 1: pawns decide. Turn 2: knights. Turn 3: bishops. Keeps no agent from dominating; produces wildly uneven games.",
  },
  {
    name: "anarchy",
    tagline: "A random proposal wins.",
    essay:
      "Pure comedy. Useful as a control: lets you see how much the strategy choice was doing in the first place.",
  },
];

export function StrategyGrid() {
  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.2em] text-ink/50 dark:text-paper/50">
          Strategies
        </span>
        <h2 className="font-serif-display text-4xl leading-tight tracking-tight sm:text-5xl">
          How the winner gets picked.
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-ink/70 dark:text-paper/70">
          The negotiation strategy is the most important choice you make. Same
          agents, same personalities, same board, but a different strategy
          produces a different game. These map to real collective-decision
          mechanisms, which is part of why watching them is interesting.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {STRATEGIES.map((s) => (
          <li
            key={s.name}
            className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-paper/60 p-4 dark:border-paper/10 dark:bg-ink/40"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-serif-display text-lg">{s.name}</span>
              <span className="font-mono-block text-[10px] uppercase tracking-[0.14em] text-ember">
                strategy
              </span>
            </div>
            <span className="text-sm text-ink/80 dark:text-paper/80">
              {s.tagline}
            </span>
            <p className="text-xs leading-relaxed text-ink/60 dark:text-paper/60">
              {s.essay}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
