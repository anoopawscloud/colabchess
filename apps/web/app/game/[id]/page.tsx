import { notFound } from "next/navigation";
import { GameViewer } from "@/components/GameViewer";
import type { Snapshot } from "@/lib/types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  "https://4ckgfcll2h.execute-api.us-east-1.amazonaws.com";

interface Params {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: Params) {
  const { id } = await params;
  const res = await fetch(`${API_BASE}/games/${id}`, { cache: "no-store" });
  if (res.status === 404) notFound();
  if (!res.ok) {
    return (
      <main className="mx-auto flex min-h-[100svh] max-w-2xl flex-col items-center justify-center gap-3 px-6 py-16">
        <h1 className="font-serif-display text-3xl">Game unavailable</h1>
        <p className="text-sm text-ink/60 dark:text-paper/60">
          The API returned {res.status}. Refresh to retry.
        </p>
      </main>
    );
  }
  const snapshot = (await res.json()) as Snapshot;
  return <GameViewer initial={snapshot} apiBase={API_BASE} />;
}
