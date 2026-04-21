import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { Construct } from "constructs";

const API_PATH = path.resolve(__dirname, "..", "..", "apps", "api");

export class ChessMindsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const gameTable = new ddb.Table(this, "GameTable", {
      tableName: "chessminds-games",
      partitionKey: { name: "pk", type: ddb.AttributeType.STRING },
      sortKey: { name: "sk", type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expires_at",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const apiFn = new lambda.Function(this, "ApiFn", {
      functionName: "chessminds-api",
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      handler: "handlers.api.handler",
      code: lambda.Code.fromAsset(API_PATH, {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          platform: "linux/arm64",
          command: [
            "bash",
            "-c",
            "pip install . --target /asset-output --no-cache-dir",
          ],
        },
      }),
      environment: {
        GAME_TABLE: gameTable.tableName,
        WATCH_URL_BASE: process.env.WATCH_URL_BASE ?? "https://chessminds.vercel.app/game",
        GAME_TTL_SECONDS: "604800",
      },
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
    });

    gameTable.grantReadWriteData(apiFn);

    const httpApi = new apigw.HttpApi(this, "HttpApi", {
      apiName: "chessminds-api",
      corsPreflight: {
        allowOrigins: [
          "https://chessminds.vercel.app",
          "http://localhost:3001",
          "http://localhost:3000",
        ],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["Content-Type", "Authorization"],
        maxAge: cdk.Duration.hours(1),
      },
    });

    const apiIntegration = new integrations.HttpLambdaIntegration(
      "ApiIntegration",
      apiFn,
    );

    httpApi.addRoutes({
      path: "/games",
      methods: [apigw.HttpMethod.POST],
      integration: apiIntegration,
    });
    httpApi.addRoutes({
      path: "/games/{game_id}",
      methods: [apigw.HttpMethod.GET],
      integration: apiIntegration,
    });
    httpApi.addRoutes({
      path: "/games/{game_id}/events",
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST],
      integration: apiIntegration,
    });
    httpApi.addRoutes({
      path: "/games/{game_id}/move",
      methods: [apigw.HttpMethod.POST],
      integration: apiIntegration,
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "GameTableName", { value: gameTable.tableName });
  }
}
