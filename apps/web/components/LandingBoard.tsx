"use client";

import { Chessboard } from "react-chessboard";

/**
 * Small decorative board for the landing page. Client-only because
 * react-chessboard relies on window. Non-interactive.
 */
export function LandingBoard({
  fen,
  size = 260,
  id = "landing-board",
}: {
  fen: string;
  size?: number;
  id?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-ink/10 shadow-sm dark:border-paper/10"
      style={{ width: size, maxWidth: "100%" }}
    >
      <Chessboard
        options={{
          position: fen,
          allowDragging: false,
          boardOrientation: "white",
          id,
        }}
      />
    </div>
  );
}
