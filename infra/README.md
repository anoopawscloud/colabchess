# chessminds-infra

AWS CDK (TypeScript) stack for Chess of Minds.

## Layout

- `bin/colabchess.ts` — CDK app entry.
- `lib/colabchess-stack.ts` — `ChessMindsStack`: DynamoDB GameTable, ApiFn, StreamFn, AnalyzeFn, HTTP API.
- `test/` — CDK unit + snapshot tests (guard against accidental stack drift).

## Commands

```
npm install
npm run synth    # cdk synth — no AWS creds needed
npm run diff     # cdk diff  — needs AWS creds
npm run deploy   # cdk deploy — needs AWS creds
```

## Regions

Default region is `us-east-1`. Override with `CDK_DEFAULT_REGION`.
