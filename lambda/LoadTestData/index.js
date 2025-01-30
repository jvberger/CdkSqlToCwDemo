import { processDbConnection } from './lib/process_db_connection.js';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export async function handler() {
    const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

    console.log('attempting to retreive SSM parameter');
    const ssmParamResponse = await ssmClient.send(
        new GetParameterCommand({ Name: '/example/SqlToCwDemo' }),
    );

    console.log('attempting to parse the Value returned from the ssm parameter as a json');
    const inputJson = JSON.parse(ssmParamResponse.Parameter.Value);
    
    const parallelConnectionHandlers = [];
    for (const dbObject of inputJson.dbConnections) {
        parallelConnectionHandlers.push(processDbConnection(dbObject));
    }

    console.log('waiting for all background connection handlers to complete');
    await Promise.all(parallelConnectionHandlers);

    return {
        statusCode: 200
    };
};

