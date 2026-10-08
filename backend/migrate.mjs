import {postgresStore,poolFromEnvironment,migratePostgres} from './postgres.mjs';
let store;
try{store=postgresStore(poolFromEnvironment(process.env,{migration:true}));await migratePostgres(store);console.log('PostgreSQL migrations complete. No application users provisioned.');}
catch{console.error('PostgreSQL migrations failed. Verify dedicated migrator credentials, schema ownership and migration checksums.');process.exitCode=1;}
finally{await store?.close();}
