import { Response, NextFunction } from "express";
import redisClient from "../config/redis";
import { AuthRequest } from "../types";

// Map to track in-flight requests for cache stampede protection
const inFlightRequests = new Map<string, Promise<any>>();

/**
 * Middleware to cache route responses
 * @param ttlSeconds Time to live in seconds
 */
export const cacheRoute = (ttlSeconds: number, cacheVersion?: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== "GET") {
      return next();
    }

    const userId = req.user?.id || "public";
    const versionSuffix = cacheVersion ? `:${cacheVersion}` : "";
    const key = `cache:${userId}:${req.originalUrl}${versionSuffix}`;

    try {
      // 1. Check Redis
      const cachedData = await redisClient.get(key);

      if (cachedData) {
        console.log(`[Cache] HIT: ${key}`);
        try {
          return res.status(200).json(JSON.parse(cachedData));
        } catch (e) {
          // If parsing fails, it might be a plain string
          return res.status(200).json(cachedData);
        }
      }

      console.log(`[Cache] MISS: ${key}`);

      // 2. Stampede Protection: Check if another request is already fetching this
      if (inFlightRequests.has(key)) {
        console.log(`[Cache] STAMPEDE PROTECTION: Waiting for in-flight request: ${key}`);
        const data = await inFlightRequests.get(key);
        return res.status(200).json(data);
      }

      // 3. Intercept res.json to cache the response
      const originalJson = res.json.bind(res);
      
      // We wrap the controller execution in a promise to track it
      let resolveInFlight: (value: any) => void;
      const inFlightPromise = new Promise((resolve) => {
        resolveInFlight = resolve;
      });
      inFlightRequests.set(key, inFlightPromise);

      res.json = (body: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const valueToCache = typeof body === "string" ? body : JSON.stringify(body);
          redisClient
            .setex(key, ttlSeconds, valueToCache)
            .catch((error) => console.error("Redis Cache Write Error:", error));
        }
        
        // Resolve the in-flight promise and cleanup
        resolveInFlight(body);
        inFlightRequests.delete(key);
        
        return originalJson(body);
      };

      next();
    } catch (error) {
      console.error("Redis Cache Error:", error);
      inFlightRequests.delete(key);
      next();
    }
  };
};

/**
 * Known cache key suffixes for deterministic invalidation.
 * Maps a base path pattern to all exact cache paths that should be cleared.
 * This avoids expensive KEYS scans over the entire Redis keyspace (critical for Upstash HTTP-based Redis).
 */
const DETERMINISTIC_KEYS: Record<string, string[]> = {
  "/v1/users/profile*": ["/v1/users/profile"],
  "/v1/users/addresses*": ["/v1/users/addresses"],
  "/v1/users/cart*": ["/v1/users/cart", "/v1/users/cart/count"],
  "/v1/orders*": ["/v1/orders/my-orders"],
};

/**
 * Middleware to clear cache after successful mutation.
 * Uses deterministic key deletion when possible to avoid KEYS scan latency.
 * @param pattern The pattern to clear, e.g., "cache:public:/api/products*" or "cache:{userId}:/api/users/cart*"
 */
export const invalidateCache = (pattern: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Invalidate cache BEFORE the controller runs to prevent race conditions.
    // Previously, invalidation happened async after res.finish, so a quick
    // GET request could still read stale cached data.
    try {
      const userId = req.user?.id || "public";
      const finalPattern = pattern.replace("{userId}", userId);

      // Extract the path portion after "cache:{userId}:"
      const pathPattern = finalPattern.replace(`cache:${userId}:`, "");
      const knownKeys = DETERMINISTIC_KEYS[pathPattern];

      if (knownKeys) {
        // Fast path: delete exact keys directly (single HTTP call)
        const exactKeys = knownKeys.map((k) => `cache:${userId}:${k}`);
        await redisClient.del(...exactKeys);
        console.log(`[Cache] DELETED (deterministic): ${exactKeys.join(", ")}`);
      } else {
        // Slow fallback: KEYS scan for non-deterministic patterns (e.g., product cache)
        console.log(`[Cache] INVALIDATING (scan): ${finalPattern}`);
        const keys = await redisClient.keys(finalPattern);
        if (keys.length > 0) {
          await redisClient.del(...keys);
          console.log(`[Cache] DELETED ${keys.length} keys`);
        }
      }
    } catch (error) {
      console.error("Redis Cache Invalidation Error:", error);
      // Don't block the request if cache invalidation fails
    }

    next(); // Proceed to the controller
  };
};
