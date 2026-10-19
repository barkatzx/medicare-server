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

export const invalidateOrderDataCaches = async (): Promise<void> => {
  await invalidateCacheTags(
    "orders",
    "tsr-sales",
    "admin-tsr-sales",
    "sales",
  );
};
