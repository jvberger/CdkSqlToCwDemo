import * as sql from 'mssql';
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
 
 /**
  * Process the dbObject and load some test data on the specified server/database. WARNING: this will create the 
  * database and demoTableName if they do not exist on the given server
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

    console.log(`[${dbObject.dbServer}][${dbObject.database}] attempting to connect to: ${dbObject.dbServer}, master database`);
    const sqlConfig = {
        user: dbSecret.username,
        database: 'master',
        password: dbSecret.password,
        server: dbObject.dbServer,
        options: {
            encrypt: true,
            trustServerCertificate: true
        }
    };
    await sql.connect(sqlConfig);

    console.log(`[${dbObject.dbServer}][${dbObject.database}] checking if database [${dbObject.database}] exists and creating it if necessary`);
    await sql.query(`
        use [master];

        if not exists (select 1 from sys.databases where name = '${dbObject.database}')
        begin
            create database [${dbObject.database}];
        end
    `);

    console.log(`[${dbObject.dbServer}][${dbObject.database}] checking if table [${demoTableName}] exists and creating it if necessary`);
    await sql.query(`
        use [${dbObject.database}];

        if not exists (select 1 from sysobjects where xtype = 'U' and name = '${demoTableName}')
        begin
            create table ${demoTableName} (id int identity primary key, countItems int not null);
        end
    `);

    console.log(`[${dbObject.dbServer}][${dbObject.database}] insert a row with a random value (0..99) for [countItems] into [${demoTableName}]`);
    await sql.query(`
        use [${dbObject.database}];

        insert into ${demoTableName}  ( countItems ) 
        values( cast( (rand() * 100) as int ) );
    `);

    return true;
}