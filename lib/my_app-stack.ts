import { Stack, StackProps, aws_iam as iam, RemovalPolicy } from "aws-cdk-lib";
import * as appsync from "aws-cdk-lib/aws-appsync";
import {
  AccountRecovery,
  UserPool,
  UserPoolClient,
  VerificationEmailStyle,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { readFileSync } from "fs";
import { resolve, join } from "path";
import {
  NodejsFunction,
  NodejsFunctionProps,
} from "aws-cdk-lib/aws-lambda-nodejs";
import { AttributeType, Table, BillingMode } from "aws-cdk-lib/aws-dynamodb";

export class MyAppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    //#region UserPool
    const userPool = new UserPool(this, "cdk-template-user-pool", {
      selfSignUpEnabled: true,
      accountRecovery: AccountRecovery.PHONE_AND_EMAIL,
      userVerification: {
        emailStyle: VerificationEmailStyle.CODE,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
    });

    const userPoolClient = new UserPoolClient(this, "UserPoolClient", {
      userPool,
    });
    //#endregion UserPool

    //#region DynamoDB
    const productTable = new Table(this, "cdk-template-productTable", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      tableName: "cdkTemplateProductTable",
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, //will delete table after deletting cloudfomration
    });
    //#endregion DynamoDB

    //#region Lambdas
    // requires this command before it works:
    // npm install --save-dev esbuild@0
    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html
    const entry = join(__dirname, "..", "lambda", "main.ts");

    const nodeJsFunctionProps: NodejsFunctionProps = {
      bundling: {
        externalModules: [
          "aws-sdk", // Use the 'aws-sdk' available in the Lambda runtime
        ],
      },
      depsLockFilePath: join(__dirname, "..", "lambda", "package-lock.json"),
    };

    const productLambda = new NodejsFunction(this, "AppSyncProductHandler", {
      entry,
      ...nodeJsFunctionProps,
    });

    productTable.grantReadWriteData(productLambda);
    productLambda.addEnvironment("PRODUCT_TABLE", productTable.tableName);

    //#endregion Lambdas

    //#region GraphQl
    const additionalAuthenticationProviderProperty: appsync.CfnGraphQLApi.AdditionalAuthenticationProviderProperty =
      {
        authenticationType: "AMAZON_COGNITO_USER_POOLS",

        // the properties below are optional
        userPoolConfig: {
          awsRegion: "us-west-2",
          userPoolId: userPool.userPoolId,
        },
      };

    const GraphQlApi = new appsync.CfnGraphQLApi(this, "'cdk-product-app", {
      name: `cdk-product-api`,
      authenticationType: "API_KEY",
      additionalAuthenticationProviders: [
        additionalAuthenticationProviderProperty,
      ],
    });

    new appsync.CfnApiKey(this, "cdk-product-app-ApiKey", {
      apiId: GraphQlApi.attrApiId,
    });

    const definition = readFileSync(
      resolve(__dirname, "../graphql/schema.graphql")
    ).toString();
    const apiSchema = new appsync.CfnGraphQLSchema(
      this,
      `cdk-product-app-schema`,
      {
        apiId: GraphQlApi.attrApiId,
        definition,
      }
    );

    //#endregion GraphQl

    //#region Resolver

    const productApp_serviceRole: iam.Role = new iam.Role(
      this,
      "appsyncServiceRole",
      {
        assumedBy: new iam.ServicePrincipal("appsync.amazonaws.com"),
      }
    );
    productApp_serviceRole.addToPolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["lambda:InvokeFunction"],
      })
    );

    const productAppFunctionDataSource = new appsync.CfnDataSource(
      this,
      "product-app-function-data-source",
      {
        apiId: GraphQlApi.attrApiId,
        name: "checkScheduleFunctionDataSource",
        type: "AWS_LAMBDA",
        lambdaConfig: {
          lambdaFunctionArn: productLambda.functionArn,
        },
        serviceRoleArn: productApp_serviceRole.roleArn,
      }
    );

    const resolverFunctionCode = readFileSync(
      join(__dirname, "./resolverFunctionCode.js"),
      "utf8"
    );

    const productAppFunctionResolverFunction =
      new appsync.CfnFunctionConfiguration(
        this,
        "product-app-resolver-function",
        {
          apiId: GraphQlApi.attrApiId,
          runtime: {
            name: "APPSYNC_JS",
            runtimeVersion: "1.0.0",
          },
          name: "productAppResolverFunction",
          dataSourceName: productAppFunctionDataSource.name,
          code: resolverFunctionCode,
        }
      );
    productAppFunctionResolverFunction.addDependency(
      productAppFunctionDataSource
    );

    const resolverCode = readFileSync(
      join(__dirname, "./resolverCode.js"),
      "utf8"
    );

    const createResolver = (
      scope: Construct,
      typeName: string,
      fieldName: string
    ) => {
      const resolver = new appsync.CfnResolver(
        scope,
        `product-app-resolver-${typeName}-${fieldName}`,
        {
          apiId: GraphQlApi.attrApiId,
          typeName,
          fieldName,
          kind: "PIPELINE",
          runtime: {
            name: "APPSYNC_JS",
            runtimeVersion: "1.0.0",
          },
          pipelineConfig: {
            functions: [productAppFunctionResolverFunction.attrFunctionId],
          },
          code: resolverCode,
        }
      );
      return resolver;
    };

    const getProductByIdAppResolver = createResolver(
      this,
      "Query",
      "getProductById"
    );
    getProductByIdAppResolver.node.addDependency(apiSchema); //not sure if it is required
    getProductByIdAppResolver.node.addDependency(
      productAppFunctionResolverFunction
    ); //not sure if it is required

    const listProductsResolver = createResolver(this, "Query", "listProducts");

    listProductsResolver.node.addDependency(apiSchema);
    listProductsResolver.node.addDependency(productAppFunctionResolverFunction);
    const productsByCategoryResolver = createResolver(
      this,
      "Query",
      "productsByCategory"
    );
    productsByCategoryResolver.node.addDependency(apiSchema);
    productsByCategoryResolver.node.addDependency(
      productAppFunctionResolverFunction
    );

    const createProductResolver = createResolver(
      this,
      "Mutation",
      "createProduct"
    );
    createProductResolver.node.addDependency(apiSchema);
    createProductResolver.node.addDependency(
      productAppFunctionResolverFunction
    );

    const deleteProductResolver = createResolver(
      this,
      "Mutation",
      "deleteProduct"
    );
    deleteProductResolver.node.addDependency(apiSchema);
    deleteProductResolver.node.addDependency(
      productAppFunctionResolverFunction
    );

    const updateProductResolver = createResolver(
      this,
      "Mutation",
      "updateProduct"
    );
    updateProductResolver.node.addDependency(apiSchema);
    updateProductResolver.node.addDependency(
      productAppFunctionResolverFunction
    );

    getProductByIdAppResolver.node.addDependency(apiSchema);
    getProductByIdAppResolver.node.addDependency(
      productAppFunctionResolverFunction
    );
    getProductByIdAppResolver.node.addDependency(apiSchema);
    getProductByIdAppResolver.node.addDependency(
      productAppFunctionResolverFunction
    );

    //#endregion Resolver
  }
}
