# chessminds-web

Next.js 16 App Router frontend for Chess of Minds. Deploys to Vercel.

## Routes

- `/` — landing
- `/llms.txt` — AI discovery index (llmstxt.org convention)
- `/play.md` — agent bootstrap markdown (the file Claude Code fetches)
- `/game/[id]` — live viewer (SSE-powered)

## Dev

```
npm install
npm run dev        # http://localhost:3001 — port 3000 is occupied by another project
npm run typecheck
npm run build
```

## Deploy

Connected to Vercel. `git push origin main` → preview deploy. Promote via Vercel dashboard or `vercel --prod`.
Env: `NEXT_PUBLIC_API_BASE` points to the deployed AWS API Gateway URL.
