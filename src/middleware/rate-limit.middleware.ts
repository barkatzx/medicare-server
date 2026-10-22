import { Request, Response, NextFunction } from "express";
import redisClient from "../config/redis";

/**
 * Basic Redis-based Rate Limiting Middleware
 * @param limit Number of requests allowed
 * @param windowSeconds Time window in seconds
 */
export const rateLimit = (
  limit: number,
  windowSeconds: number,
  scope?: string,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const key = `ratelimit:${scope ?? req.path}:${ip}`;

    try {
      const current = await redisClient.get(key);
      const count = current ? parseInt(current) : 0;

      if (count >= limit) {
        console.warn(`[RateLimit] Blocked IP: ${ip} for path: ${req.path}`);
        return res.status(429).json({
          error: "Too many requests. Please try again later.",
          retryAfter: windowSeconds,
        });
      }

      if (count === 0) {
        // First request in the window, set expiry
        await redisClient.setex(key, windowSeconds, 1);
      } else {
        // Increment count
        await redisClient.incr(key);
      }

      // Add headers for transparency
      res.setHeader("X-RateLimit-Limit", limit);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, limit - (count + 1)));

      next();
    } catch (error) {
      console.error("Rate Limit Error:", error);
      // In case of Redis failure, we allow the request to proceed (fail open)
      next();
    }
  };
};
