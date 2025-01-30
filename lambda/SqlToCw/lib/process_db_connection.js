import * as sql from 'mssql';
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

 /**
  * Process the dbObject, select the latest data from demoTableName, and upload to specied namespace/metricName. 
  * We pass the server name and database as dimensions. Update as desired
  * 
  * @param {Object} dbObject 
  * @param {string} dbObject.dbSecretId - secret id containing username/password for db account to use
  * @param {string} dbObject.dbServer - database server fqdn to query
  * @param {string} dbObject.database - database to query on the given dbServer
  */

 export async function processDbConnection(dbObject) {
    const demoTableName = 'SqlToCwTable';
    const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

    console.log(`[${dbObject.dbServer}][${dbObject.database}] retrieving secret for SecretId ${dbObject.dbSecretId}`);
    const dbSecretResult = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: dbObject.dbSecretId }),
    );
    const dbSecret = JSON.parse(dbSecretResult.SecretString);

    const sqlConfig = {
        user: dbSecret.username,
        database: dbObject.database,
        password: dbSecret.password,
        server: dbObject.dbServer,
        options: {
            encrypt: true,
            trustServerCertificate: true
        }
    };

    console.log(`[${dbObject.dbServer}][${dbObject.database}] attempting to connect to: ${dbObject.dbServer}, ${dbObject.database} database`);
    await sql.connect(sqlConfig);

    console.log(`[${dbObject.dbServer}][${dbObject.database}] querying ${demoTableName} for the latest record`);
    const selectResult = await sql.query(`
        use [${dbObject.database}];

        select top(1) id,countItems from ${demoTableName} order by id desc
    `);

    // Only have one metric here, but returning as an array as an example of how we could handle many
    return [{
        MetricName: 'TestMetric',
        Dimensions: [
            { Name: 'server', Value: dbObject.dbServer },
            { Name: 'database', Value: dbObject.database }
        ],
        Unit: 'Count',
        Value: selectResult.recordset[0].countItems
    }];
}