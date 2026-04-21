import { ROLE_GLYPH, ROLE_ACCENT, isRole, type Role } from "@/lib/agents";

export interface BarDatum {
  role: string;
  confidence: number | null;
  move?: string;
}

/**
 * Visual summary of a round of proposals: one horizontal bar per agent,
 * bar length proportional to confidence, winner highlighted in ember.
 * Matches the landing-page Step 3 chart so users see the same visual
 * language in both places.
 */
export function NegotiationBars({
  data,
  winnerRole,
}: {
  data: BarDatum[];
  winnerRole: string | null;
}) {
  if (data.length === 0) return null;
  const maxConf = Math.max(...data.map((d) => d.confidence ?? 0), 1);
  return (
    <ul className="flex flex-col gap-1.5">
      {data.map((d, i) => {
        const isWinner = winnerRole !== null && d.role === winnerRole;
        const conf = d.confidence ?? 0;
        const pct = maxConf > 0 ? Math.round((conf / maxConf) * 100) : 0;
        const glyph = isRole(d.role) ? ROLE_GLYPH[d.role as Role] : "·";
        const accent = isRole(d.role) ? ROLE_ACCENT[d.role as Role] : "";
        return (
          <li
            key={`${d.role}-${i}`}
            className="flex items-center gap-2"
            title={`${d.role}${d.move ? ` → ${d.move}` : ""}  conf ${conf}`}
          >
            <span
              className={`w-5 shrink-0 text-base leading-none ${accent} ${
                isWinner ? "" : "opacity-50"
              }`}
            >
              {glyph}
            </span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink/10 dark:bg-paper/10">
              <div
                className={`h-full rounded-full transition-[width] ${
                  isWinner ? "bg-ember" : "bg-ink/30 dark:bg-paper/30"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span
              className={`w-7 shrink-0 text-right font-mono-block text-[10px] ${
                isWinner
                  ? "text-ember"
                  : "text-ink/50 dark:text-paper/50"
              }`}
            >
              {d.confidence ?? "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
