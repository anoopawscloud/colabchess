export const ROLES = [
  "king",
  "queen",
  "rooks",
  "bishops",
  "knights",
  "pawns",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_GLYPH: Record<Role, string> = {
  king: "♚",
  queen: "♛",
  rooks: "♜",
  bishops: "♝",
  knights: "♞",
  pawns: "♟",
};

export const ROLE_LABEL: Record<Role, string> = {
  king: "King",
  queen: "Queen",
  rooks: "Rooks",
  bishops: "Bishops",
  knights: "Knights",
  pawns: "Pawns",
};

export const ROLE_ACCENT: Record<Role, string> = {
  king: "text-amber-600 dark:text-amber-400",
  queen: "text-rose-600 dark:text-rose-400",
  rooks: "text-stone-700 dark:text-stone-300",
  bishops: "text-indigo-600 dark:text-indigo-400",
  knights: "text-emerald-700 dark:text-emerald-400",
  pawns: "text-sky-700 dark:text-sky-400",
};

export function isRole(s: string): s is Role {
  return (ROLES as readonly string[]).includes(s);
}
