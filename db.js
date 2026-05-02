const { Pool } = require('pg');

const pool = new Pool({
  user: 'ashritha',         // your DB username
  host: 'localhost',        // usually localhost
  database: 'lifenest',     // your DB name
  password: 'ashritha',     // your DB password
  port: 5432,               // default Postgres port
});

module.exports = pool;
