import redisClient from "../config/redis";

const cacheTagVersionKey = (tag: string) => `cache:tag-version:${tag}`;

export const getCacheTagVersionSuffix = async (
  tags: string[],
): Promise<string> => {
  if (tags.length === 0) return "";

  const uniqueTags = [...new Set(tags)].sort();
  const versions = await redisClient.mget(
    ...uniqueTags.map(cacheTagVersionKey),
  );

  return `:tags:${uniqueTags
    .map((tag, index) => `${tag}=${versions[index] ?? "0"}`)
    .join(":")}`;
};

export const invalidateCacheTags = async (...tags: string[]): Promise<void> => {
  const uniqueTags = [...new Set(tags)];
  if (uniqueTags.length === 0) return;

  try {
    await Promise.all(
      uniqueTags.map((tag) => redisClient.incr(cacheTagVersionKey(tag))),
    );
  } catch (error) {
    console.error("[Cache] Tag invalidation error:", error);
  }
};

export const invalidateProductDataCaches = async (): Promise<void> => {
  await invalidateCacheTags("products");
  try {
    const keys = (
      await Promise.all(
        ["products:new*", "products:trending*", "products:featured*"].map(
          (pattern) => redisClient.keys(pattern),
        ),
      )
    ).flat();
    if (keys.length > 0) await redisClient.del(...keys);
  } catch (error) {
    console.error("[Cache] Product cache invalidation error:", error);
  }
};

// Orders change product stock, so product caches must be cleared too.
export const invalidateOrderDataCaches = async (): Promise<void> => {
  await invalidateProductDataCaches();
  await invalidateCacheTags(
    "orders",
    "tsr-sales",
    "admin-tsr-sales",
    "sales",
  );
};
