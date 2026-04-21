"use client";

import { useState } from "react";

export function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can manually select */
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-lg border border-ink/15 bg-ink/[0.04] p-5 font-mono-block text-[15px] dark:border-paper/15 dark:bg-paper/[0.04]">
      <code className="block pr-24 leading-relaxed">
        <span className="text-ember">&gt;</span> {command}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="absolute right-3 top-3 rounded-md border border-ink/15 bg-paper/60 px-3 py-1 font-sans text-xs text-ink/70 transition hover:border-ember hover:text-ember dark:border-paper/20 dark:bg-ink/60 dark:text-paper/70"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
