import { processDbConnection } from './lib/process_db_connection.js';
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export async function handler() {
    const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
    const namespace = 'TestNamespace';

    console.log('attempting to retreive SSM parameter');
    const ssmParamResponse = await ssmClient.send(
        new GetParameterCommand({ Name: '/example/SqlToCwDemo' }),
    );

    console.log('attempting to parse the Value returned from the ssm parameter as a json');
    const inputJson = JSON.parse(ssmParamResponse.Parameter.Value);
    
    // Let all of the db connection handling happen asyncronously. If you have a lot of connections, consider doing 
    // smaller number at a time (e.g. 10). If you do not want these to be async, simply wait for each 
    //  (await processDbConnection(dbObject))
    // and remove the Promise.all await at the end. 
    const parallelConnectionHandlers = [];
    for (const dbObject of inputJson.dbConnections) {
        parallelConnectionHandlers.push(processDbConnection(dbObject));
    }
    console.log('waiting for all background connection handlers to complete');

    // This will be an array of arrays of the metrics returned by each connection handler
    const metricsToPostArrays = await Promise.all(parallelConnectionHandlers);
    const metricsToPost = metricsToPostArrays.flat(1);
    
    console.log(`writing metrics to cloudwatch, namespace [${namespace}], number of metrics [${metricsToPost.length}]`)
    const cwClient = new CloudWatchClient({ region: process.env.AWS_REGION });
    await cwClient.send(new PutMetricDataCommand({
        Namespace: namespace,
        MetricData: metricsToPost
    }));

    return {
        statusCode: 200
    };
};

