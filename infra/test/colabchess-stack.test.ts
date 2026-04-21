import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { ChessMindsStack } from "../lib/colabchess-stack";

function synth(): Template {
  const app = new cdk.App();
  const stack = new ChessMindsStack(app, "Test");
  return Template.fromStack(stack);
}

test("DynamoDB table has correct key schema and TTL", () => {
  const t = synth();
  t.hasResourceProperties("AWS::DynamoDB::Table", {
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    BillingMode: "PAY_PER_REQUEST",
    TimeToLiveSpecification: {
      AttributeName: "expires_at",
      Enabled: true,
    },
  });
});

test("API Lambda has Python 3.12 runtime + correct handler", () => {
  const t = synth();
  t.hasResourceProperties("AWS::Lambda::Function", {
    Runtime: "python3.12",
    Handler: "handlers.api.handler",
    Environment: {
      Variables: Match.objectLike({
        GAME_TABLE: Match.anyValue(),
        WATCH_URL_BASE: Match.anyValue(),
        GAME_TTL_SECONDS: "604800",
      }),
    },
  });
});

test("HTTP API declares all four CRUD routes", () => {
  const t = synth();
  const routes = t.findResources("AWS::ApiGatewayV2::Route");
  const routeKeys = Object.values(routes).map(
    (r: any) => r.Properties.RouteKey,
  );
  expect(routeKeys).toEqual(
    expect.arrayContaining([
      "POST /games",
      "GET /games/{game_id}",
      "GET /games/{game_id}/events",
      "POST /games/{game_id}/events",
      "POST /games/{game_id}/move",
    ]),
  );
});

test("Lambda gets scoped read/write on the game table (not '*')", () => {
  const t = synth();
  const policies = Object.values(t.findResources("AWS::IAM::Policy"));
  expect(policies.length).toBeGreaterThan(0);
  const stmts = policies.flatMap((p: any) =>
    p.Properties.PolicyDocument.Statement,
  );
  // Confirm we don't grant "*" on DynamoDB.
  const dynamoStmts = stmts.filter((s: any) =>
    JSON.stringify(s.Action).includes("dynamodb:"),
  );
  expect(dynamoStmts.length).toBeGreaterThan(0);
  for (const s of dynamoStmts) {
    expect(JSON.stringify(s.Resource)).not.toBe('"*"');
  }
});

test("CORS allows the Vercel origin", () => {
  const t = synth();
  t.hasResourceProperties("AWS::ApiGatewayV2::Api", {
    CorsConfiguration: {
      AllowOrigins: Match.arrayWith(["https://chessminds.vercel.app"]),
      AllowMethods: Match.arrayWith(["GET", "POST", "OPTIONS"]),
    },
  });
});

test("Stack outputs the API URL and table name", () => {
  const t = synth();
  t.hasOutput("ApiUrl", Match.anyValue());
  t.hasOutput("GameTableName", Match.anyValue());
});
