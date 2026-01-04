import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

// Database connection configuration
const getDatabaseUrl = () => {
  // Check for explicit DATABASE_URL
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Fall back to individual connection params
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_NAME || 'devorbit';
  const user = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || 'postgres';

  return `postgres://${user}:${password}@${host}:${port}/${database}`;
};

// Create pool with error handling
let pool = null;
let db = null;
let isConnected = false;

/**
 * Initialize the database connection
 * @returns {Promise<boolean>} - Whether connection was successful
 */
export async function initializeDatabase() {
  if (isConnected && db) {
    return true;
  }

  try {
    const connectionString = getDatabaseUrl();

    pool = new Pool({
      connectionString,
      max: 10, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test the connection
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    // Create Drizzle instance
    db = drizzle(pool, { schema });
    isConnected = true;

    console.log('✅ Database connected successfully');
    return true;
  } catch (error) {
    console.warn('⚠️  Database connection failed:', error.message);
    console.warn('   Running in file-based mode (localStorage fallback)');
    isConnected = false;
    return false;
  }
}

/**
 * Get the Drizzle database instance
 * @returns {object|null} - Drizzle DB instance or null if not connected
 */
export function getDb() {
  return db;
}

/**
 * Check if database is connected
 * @returns {boolean}
 */
export function isDatabaseConnected() {
  return isConnected;
}

/**
 * Close the database connection
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    isConnected = false;
  }
}

// Export schema for use in queries
export { schema };
