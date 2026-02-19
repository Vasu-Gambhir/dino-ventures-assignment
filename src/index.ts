import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import pool from './config/database';

const PORT = process.env.PORT || 3000;

async function start() {
  // Verify database connection
  try {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL');
    client.release();
  } catch (err) {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Wallet service running on port ${PORT}`);
  });
}

start();
