import { prisma } from "../config/supabase";
import redisClient from "../config/redis";
import { DiscountService } from "./discount.service";

export class ProductService {
  private static CACHE_TTL = 300; // 5 minutes

  /**
   * Helper to format products with discount calculations
   */
  private static formatProducts(products: any[]) {
    return products.map((product) => {
      const finalPrice = DiscountService.calculateFinalPrice(
        Number(product.price),
        product.discountedPrice ? Number(product.discountedPrice) : null,
        product.discountPercent,
      );

      return {
        ...product,
        price: Number(product.price),
        discountedPrice: product.discountedPrice
          ? Number(product.discountedPrice)
          : null,
        distributor: product.distributor?.name ?? null,
        distributorId: product.distributorId,
        tp: product.tp == null ? null : Number(product.tp),
        finalPrice,
        savings: DiscountService.calculateSavings(
          Number(product.price),
          finalPrice,
        ),
        discountPercent:
          product.discountPercent ||
          DiscountService.calculateDiscountPercent(
            Number(product.price),
            finalPrice,
          ),
      };
    });
  }

  /**
   * Invalidates product-related caches
   */
  static async invalidateProductCaches() {
    const [trendingKeys, featuredKeys] = await Promise.all([
      redisClient.keys("products:trending*"),
      redisClient.keys("products:featured*"),
    ]);

    await redisClient.del(
      "products:new",
      ...trendingKeys,
      ...featuredKeys,
    );
  }

  /**
   * Get trending products (cached)
   */
  static async getTrendingProducts(
    page: number = 1,
  ): Promise<{ products: any[]; total: number }> {
    const limit = 20;
    const skip = (page - 1) * limit;
    const cacheKey = `products:trending:${page}`;
    const cachedProducts = await redisClient.get(cacheKey);

    if (cachedProducts) {
      try {
        return JSON.parse(cachedProducts);
      } catch (e) {
        console.error("[Cache] Parsing error for trending products:", e);
      }
    }

    const where = {
      trending: true,
      stock: { gt: 0 },
    };
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          images: true,
          category: true,
          distributor: {
            select: { name: true },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    const result = {
      products: this.formatProducts(products),
      total,
    };

    await redisClient.setex(
      cacheKey,
      this.CACHE_TTL,
      JSON.stringify(result),
    );

    return result;
  }

  /**
   * Get featured products (cached)
   */
  static async getFeaturedProducts(
    page: number = 1,
  ): Promise<{ products: any[]; total: number }> {
    const limit = 20;
    const skip = (page - 1) * limit;
    const cacheKey = `products:featured:${page}`;
    const cachedProducts = await redisClient.get(cacheKey);

    if (cachedProducts) {
      try {
        return JSON.parse(cachedProducts);
      } catch (e) {
        console.error("[Cache] Parsing error for featured products:", e);
      }
    }

    const where = {
      featured: true,
      stock: { gt: 0 },
    };
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          images: true,
          category: true,
          distributor: {
            select: { name: true },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    const result = {
      products: this.formatProducts(products),
      total,
    };

    await redisClient.setex(
      cacheKey,
      this.CACHE_TTL,
      JSON.stringify(result),
    );

    return result;
  }

  /**
   * Update trending status for a product
   */
  static async updateTrendingStatus(
    productId: string,
    trending: boolean,
  ) {
    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        trending,
      },
      include: {
        images: true,
        category: true,
        distributor: {
          select: { name: true },
        },
      },
    });

    await this.invalidateProductCaches();
    
    const formattedProducts = this.formatProducts([updatedProduct]);
    return formattedProducts[0];
  }

  /**
   * Update featured status for a product
   */
  static async updateFeaturedStatus(productId: string, featured: boolean) {
    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        featured,
      },
      include: {
        images: true,
        category: true,
        distributor: {
          select: { name: true },
        },
      },
    });

    await this.invalidateProductCaches();

    const formattedProducts = this.formatProducts([updatedProduct]);
    return formattedProducts[0];
  }

  /**
   * Get products added in the last 15 days (cached with pagination)
   */
  static async getNewProducts(
    page: number = 1,
    limit: number = 20,
  ): Promise<{ products: any[]; total: number }> {
    const skip = (page - 1) * limit;
    const cacheKey = `products:new:${page}:${limit}`;
    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      try {
        return JSON.parse(cachedData);
      } catch (e) {
        console.error("[Cache] Parsing error for new products:", e);
      }
    }

    // Calculate the date 15 days ago
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    const where = {
      createdAt: {
        gte: fifteenDaysAgo,
      },
      stock: { gt: 0 },
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          images: true,
          category: true,
          distributor: {
            select: { name: true },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    const formattedProducts = this.formatProducts(products);
    const responseData = {
      products: formattedProducts,
      total,
    };

    await redisClient.setex(cacheKey, this.CACHE_TTL, JSON.stringify(responseData));

    return responseData;
  }
}
