# chessminds-infra

AWS CDK (TypeScript) stack for Chess of Minds. Deploys the **passive relay** backend — DynamoDB + Lambda + HTTP API Gateway.

Full design reasoning: [../ARCHITECTURE.md](../ARCHITECTURE.md).

---

## Stack contents

One stack: `ChessMindsStack` in `lib/colabchess-stack.ts`.

| Resource | Logical name | Why |
|---|---|---|
| DynamoDB table | `GameTable` | Single-table event log. PK=`GAME#{id}`, SK=`META` or `EVENT#{seq}`. TTL on `expires_at` sweeps rows at 7 days. Pay-per-request billing. |
| Lambda | `ApiFn` | Python 3.12 on **arm64**, 512 MB / 10s. Bundled via Docker with `pip install . --target /asset-output`. Handler is `handlers.api.handler`. |
| IAM role + policy | (auto-generated) | Lambda granted scoped read/write on the table, plus `AWSLambdaBasicExecutionRole` for CloudWatch logs. |
| HTTP API Gateway v2 | `HttpApi` | CORS open (`*` origins, methods, headers). 5 routes: POST /games, GET /games/{id}, GET+POST /games/{id}/events, POST /games/{id}/move. All integrated to the same Lambda via `HttpLambdaIntegration`. |
| CloudFormation outputs | `ApiUrl`, `GameTableName` | Wire up Vercel env vars from these. |

---

## Commands

```bash
# Install CDK + deps
npm install

# Synth to CloudFormation (no AWS creds needed; Docker required for Lambda bundling)
npx cdk synth

# Diff vs deployed stack (needs AWS creds)
npx cdk diff

# Deploy (needs AWS creds)
npx cdk deploy --require-approval never

# Destroy
npx cdk destroy
```

Deployments take ~45s. CDK re-bundles the Lambda on every deploy (the bundling uses content hashing under the hood so hash-identical source skips re-upload).

---

## Tests

```bash
npm test        # jest — 6 CDK synth-assertion tests, ~4 min (each test synths the stack, which runs Docker bundling)
```

Tests live in `test/colabchess-stack.test.ts`. They assert:

1. DynamoDB table has the correct key schema + TTL configured.
2. Lambda has Python 3.12 runtime + correct handler + env vars.
3. HTTP API declares all five CRUD routes (tolerant to route-key ordering).
4. Lambda gets scoped DDB access (not `*`).
5. CORS allows `*` + `Authorization` header.
6. Stack outputs the API URL and table name.

Slow because each test creates a fresh `cdk.App` + `ChessMindsStack`, which triggers Docker Lambda bundling. A future refactor could synth once per file and share the `Template` across tests — worth it if we cross ~15 tests.

---

## Prerequisites

- **Node 20+** (we're on 23).
- **AWS CLI configured** — we use the default profile. Check: `aws sts get-caller-identity`.
- **Docker running** — CDK Lambda bundling uses `lambda.Runtime.PYTHON_3_12.bundlingImage`. Check: `docker version`.
- **CDK bootstrap** — one-time per account/region: `npx cdk bootstrap`. Our account is already bootstrapped in `us-east-1`.

---

## Environment config

CDK reads from `process.env` at synth time:

| Var | Purpose | Default |
|---|---|---|
| `CDK_DEFAULT_ACCOUNT` | AWS account | from profile |
| `CDK_DEFAULT_REGION` | AWS region | `us-east-1` |
| `WATCH_URL_BASE` | Set on Lambda env as `WATCH_URL_BASE` (prefix used when composing `watch_url`) | `https://chessminds-psi.vercel.app/game` |

---

## Architecture notes

**Why arm64 Lambda.** Matches our Mac dev host, ~20% cheaper per GB-s. Bundling native wheels (pydantic_core) stays correct when the bundler pulls aarch64 wheels — we explicitly `platform: "linux/arm64"` so cross-platform dev hosts also produce ARM output via QEMU emulation.

**Why `*` CORS.** Writes are bearer-token gated. Reads are public by design. No credentials are ever sent. This lets viewer URLs come from any Vercel preview domain without maintenance.

**Why single-table DDB.** Ordered event streams per game without joins. `Query(PK, SK BETWEEN "EVENT#{since+1:08d}" AND "EVENT#99999999")` returns the event tail since the cursor. The `BETWEEN` bound is load-bearing — a naive `SK > "EVENT#..."` also returns the META row alphabetically.

**Why Powertools (not Mangum + FastAPI).** Lighter cold-start. No ASGI shim. The routes we expose are simple enough that Powertools' `APIGatewayHttpResolver` is the right tool.

More context in [../ARCHITECTURE.md](../ARCHITECTURE.md).

---

## Deploy playbook

```bash
# Sanity check
aws sts get-caller-identity
docker version

# Preview
cd infra
npx cdk diff

# Apply
npx cdk deploy --require-approval never

# Verify
curl -fsS -X POST $(aws cloudformation describe-stacks \
  --stack-name ChessMindsStack --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)/games \
  -H "content-type: application/json" -d '{}' | jq .
```

Full end-to-end smoke script lives at `/tmp/colabchess/smoke.sh` when present — 7 curl checks against the deployed API (create, snapshot, legal move, illegal move, event append, polling, auth rejection).

---

## Troubleshooting

**`ImportModuleError: No module named 'pydantic_core._pydantic_core'` at Lambda cold start.** Architecture mismatch. Native wheel is ARM but Lambda is running x86, or vice versa. Check:

1. `architecture: lambda.Architecture.ARM_64` in the stack.
2. `bundling.platform: "linux/arm64"` in the asset config.
3. Either redeploy (forces bundle rebuild) or `rm -rf cdk.out` to clear cached assets.

**CDK bootstrap `UPDATE_ROLLBACK_COMPLETE`.** The bootstrap stack is in a previous-version state. Functional for deploys. Run `npx cdk bootstrap` again if you want the current template.

**`jest` stalls on the first test.** First run pulls the Lambda bundling image (~300 MB). Subsequent runs hit the cache.

More in `~/.claude/statefiles/colabchess/state-learnings.md`.
