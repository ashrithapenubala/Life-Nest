const pool = require('./db'); // make sure db.js is in the same folder

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Connection error', err.stack);
  }
  console.log('✅ Connected to PostgreSQL successfully!');

  // Optional: run a simple query
  client.query('SELECT NOW()', (err, result) => {
    release(); // release the client back to the pool
    if (err) {
      return console.error('Query error', err.stack);
    }
    console.log('Current time from PostgreSQL:', result.rows[0].now);
  });
});
