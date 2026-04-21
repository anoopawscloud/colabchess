interface Params {
  params: Promise<{ id: string }>;
}

export default async function GamePage({ params }: Params) {
  const { id } = await params;
  return (
    <main className="mx-auto flex min-h-[100svh] max-w-2xl flex-col items-center justify-center gap-6 px-6 py-16">
      <p className="font-mono-block text-xs uppercase tracking-[0.2em] text-ink/50 dark:text-paper/50">
        Game
      </p>
      <h1 className="font-serif-display text-4xl tracking-tight">
        {id}
      </h1>
      <p className="max-w-sm text-center text-ink/70 dark:text-paper/70">
        Live viewer arrives in Cut 3 — animated board, agent cards, streaming
        negotiation feed. For now, the API has the game state.
      </p>
    </main>
  );
}
