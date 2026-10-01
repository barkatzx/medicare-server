import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisClient = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 0,
  enableOfflineQueue: false,
  commandTimeout: 2000,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

// Handle connection errors
redisClient.on("error", (err: any) => {
  if (err.code === "ENOTFOUND") {
    console.error(
      "[Redis] Host not found. If you are running locally, ensure you are using the External Redis URL from Render.",
    );
  } else {
    console.error("[Redis] Connection Error:", err);
  }
});

export const connectRedis = async () => {
  try {
    if (redisClient.status !== "ready") {
      await new Promise<void>((resolve) => {
        redisClient.once("ready", resolve);
      });
    }

    const response = await redisClient.ping();
    console.log("Redis Client Connected:", response);
  } catch (error) {
    console.error("Redis Ping Failed. Continuing without cache...");
  }
};

export default redisClient;
