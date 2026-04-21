#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ChessMindsStack } from "../lib/colabchess-stack";

const app = new cdk.App();

new ChessMindsStack(app, "ChessMindsStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  description: "Chess of Minds — API + SSE + Stockfish",
});
