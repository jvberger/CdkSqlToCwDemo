import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as ssm from 'aws-cdk-lib/aws-ssm';

/**
 * This stack is meant to demonstrate how create node.js Lambda functions through CDK. 
 * 
 * This stack creates the following resources:
 * 
 * * LoadTestData              - Lambda function to loads test data into a couple of databases
 * * SqlToCw                   - Lmabda function to take some of the test data and report to CW
 * * EventBridge-LoadTestData  - EventBridge rule to load some test data every 5 minutes 
 * * EventBridge-SqlToCw       - EventBridge rule to run SqlToCw every 5 minutes
 * * /example/SqlToCwDemo      - SSM string parameter used by both lambdas to get the db servers/databases to query
 * 
 */

export class NodeStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import an existing vpc to use for our lambda deployment
    const vpcId = 'vpc-example';
    const vpc = ec2.Vpc.fromLookup(this, 'ImportVpc', { vpcId: vpcId });

    /**
     * You can choose how to pass the servers to query to your lambda function. Some potential options
     * 1) Event (more useful if you want to let lambda handle concurancy and have different events for differnet servers, but could also have your full json as an event)
     * 2) Lambda enviroment variables - Fine if you just have a single lambda, but slightly harder to maintain 
     * 3) SSM parameter store - Good, especially if you have multiple lambda functions/etc.. going off the same list
     * 
     * Here we are just going to create an SSM parameter store parameter to hold the JSON. 
     * Note this doesn't have to be done through CDK, both lambdas just reference to the hardcoded parameter, so you can modify outside of cdk
     */

    const json = `{
  "dbConnections": [
    {
      "dbSecretId": "prod/rds",
      "dbServer": "database-2.example12345.us-east-1.rds.amazonaws.com",
      "database": "SqlToCwDemo1"
    },
    {
      "dbSecretId": "prod/rds",
      "dbServer": "database-2.example12345.us-east-1.rds.amazonaws.com",
      "database": "SqlToCwDemo2"
    }
  ]
}`;

    new ssm.StringParameter(this, 'SsmParam-SqlToCwDemo', {
      parameterName: '/example/SqlToCwDemo',
      stringValue: json
    });

    // Define some shared properties to use with both lambda function.
    // This can be split out into a function or construct, but keeping together here for simplicty for the demo
    const sharedLambdaProperties = {
      vpc: vpc,
      allowPublicSubnet: false,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }), // update if needed
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler', // index is the file name, handler is the entry function (update if needed)
      timeout: cdk.Duration.seconds(60), // update if needed
      memorySize: 128, // this is in MB (128 MB is default)
      architecture: lambda.Architecture.X86_64, // potentially consider ARM at higher memory sizes (e.g. > 1 GB), otherwise x86 is usually cheaper/faster
      environment: {}, // add any enviroment variables you would like
      // bundling for node will be done by esbuild (see package.json) or docker if esbuild is not present
      bundling: {
        externalModules: [],
        minify: true,
        nodeModules: []
      }
    };

    // Create lambda to populate test data
    const lambdaLoadTestData = new nodejs.NodejsFunction(this, 'Lambda-LoadTestData', {
      functionName: 'LoadTestData',
      entry: 'lambda/LoadTestData/index.js',
      ...sharedLambdaProperties
    });

    // Add event bridge rule for every 5 minutes
    new events.Rule(this, `EventBridge-LoadTestData`, {
      ruleName: `EventBridge-${lambdaLoadTestData.functionName}`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [
        new targets.LambdaFunction(lambdaLoadTestData, {
          event: events.RuleTargetInput.fromObject({})
        })
      ]
    });

    // Create lambda to report some of the data to CW
    const lambdaSqlToCw = new nodejs.NodejsFunction(this, 'Lambda-SqlToCw', {
      functionName: 'SqlToCw',
      entry: 'lambda/SqlToCw/index.js',
      ...sharedLambdaProperties
    });

    // Add event bridge rule for every 5 minutes
    new events.Rule(this, `EventBridge-SqlToCw`, {
      ruleName: `EventBridge-${lambdaSqlToCw.functionName}`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [
        new targets.LambdaFunction(lambdaSqlToCw, {
          event: events.RuleTargetInput.fromObject({})
        })
      ]
    });

    // Update lambda roles with SecretsManager and CW permissions
    for (const lambda of [lambdaLoadTestData, lambdaSqlToCw]) {
      // Update permissions to allow getting db credentials (TODO: If using in prod, limit this to sepecific secrets as best practice)
      lambda.role?.addToPrincipalPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['*'] // Limit to specific secrets if desired
      }));

      // Update permissions to allow reading SSM (TODO: If using in prod, limit this to sepecific secrets as best practice)
      lambda.role?.addToPrincipalPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: ['*']
      }));

      // Update permissions to allow writing CW metrics
      lambda.role?.addToPrincipalPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*']
      }));
    }
  }
}
