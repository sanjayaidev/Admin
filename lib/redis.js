// lib/redis.js
// Redis client for caching, sessions, and real-time features

const { createClient } = require('redis');

let redisClient = null;

async function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  // Build Redis URL from environment variables
  const redisUrl = process.env.REDIS_URL || 
    `redis://default:${process.env.REDISPASSWORD || 'pZlavLQOvIlqmJCzRqCsgqWBhQWXgxPx'}@${process.env.REDISHOST || 'localhost'}:${process.env.REDISPORT || '6379'}`;

  redisClient = createClient({
    url: redisUrl
  });

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err.message);
  });

  redisClient.on('connect', () => {
    console.log('✅ Redis connected successfully');
  });

  try {
    await redisClient.connect();
    console.log('🔴 Redis client initialized');
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err.message);
    // Continue without Redis for development
  }

  return redisClient;
}

// Cache utilities
async function cacheSet(key, value, ttlSeconds = 3600) {
  try {
    const client = await getRedisClient();
    if (!client || !client.isOpen) return false;
    
    await client.setEx(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('Redis cacheSet error:', err.message);
    return false;
  }
}

async function cacheGet(key) {
  try {
    const client = await getRedisClient();
    if (!client || !client.isOpen) return null;
    
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    console.error('Redis cacheGet error:', err.message);
    return null;
  }
}

async function cacheDelete(key) {
  try {
    const client = await getRedisClient();
    if (!client || !client.isOpen) return false;
    
    await client.del(key);
    return true;
  } catch (err) {
    console.error('Redis cacheDelete error:', err.message);
    return false;
  }
}

async function cacheInvalidate(pattern) {
  try {
    const client = await getRedisClient();
    if (!client || !client.isOpen) return false;
    
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(keys);
    }
    return true;
  } catch (err) {
    console.error('Redis cacheInvalidate error:', err.message);
    return false;
  }
}

// Session management with Redis
async function setSession(sessionId, data, ttlSeconds = 86400 * 7) {
  return cacheSet(`session:${sessionId}`, data, ttlSeconds);
}

async function getSession(sessionId) {
  return cacheGet(`session:${sessionId}`);
}

async function deleteSession(sessionId) {
  return cacheDelete(`session:${sessionId}`);
}

module.exports = {
  getRedisClient,
  cacheSet,
  cacheGet,
  cacheDelete,
  cacheInvalidate,
  setSession,
  getSession,
  deleteSession
};
