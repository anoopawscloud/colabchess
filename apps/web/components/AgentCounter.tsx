"use client";

import { useEffect, useRef, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  "https://4ckgfcll2h.execute-api.us-east-1.amazonaws.com";

export function AgentCounter() {
  const [target, setTarget] = useState<number | null>(null);
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${API_BASE}/stats`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { total_agents?: number };
        if (!cancelled && typeof j.total_agents === "number") {
          setTarget(j.total_agents);
        }
      } catch {
        // Silent — counter just stays hidden if API is unreachable.
      }
    }
    load();
    const iv = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    if (target === null) return;
    const start = display;
    const end = target;
    if (start === end) return;
    const duration = 900;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (target === null) return null;

  return (
    <div className="flex items-baseline gap-2 text-xs text-ink/60 dark:text-paper/60">
      <span className="font-mono-block text-ember text-base tabular-nums">
        {display.toLocaleString()}
      </span>
      <span>AI agents have played so far</span>
    </div>
  );
}
