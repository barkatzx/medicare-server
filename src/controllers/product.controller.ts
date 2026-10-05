// src/controllers/product.controller.ts
import { Request, Response } from "express";
import { prisma } from "../config/supabase";
import { DiscountService } from "../services/discount.service";
import { ImageService } from "../services/image.service";
import { AuthRequest } from "../types";
import { ProductService } from "../services/product.service";

const formatProductTp = <
  T extends {
    tp: unknown;
    distributorId?: string | null;
    distributor?: { name: string } | string | null;
  },
>(
  product: T,
) => ({
  ...product,
  distributor:
    typeof product.distributor === "string"
      ? product.distributor
      : product.distributor?.name ?? null,
  distributorId: product.distributorId ?? null,
  tp: product.tp == null ? null : Number(product.tp),
});

const parseStockStatusPagination = (query: Request["query"]) => {
  const requestedPage =
    typeof query.page === "string" ? Number.parseInt(query.page, 10) : NaN;
  const requestedLimit =
    typeof query.limit === "string" ? Number.parseInt(query.limit, 10) : NaN;
  const page = Number.isInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : 1;
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 20)
      : 20;

  return { page, limit, skip: (page - 1) * limit };
};

type DistributorInputResult =
  | { ok: true; distributorId: string | null | undefined }
  | { ok: false; status: 400 | 404; error: string };

const resolveDistributorInput = async (
  body: Record<string, unknown>,
): Promise<DistributorInputResult> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Invalid product request body" };
  }

  const hasDistributorId = Object.prototype.hasOwnProperty.call(
    body,
    "distributorId",
  );
  const hasDistributorName = Object.prototype.hasOwnProperty.call(
    body,
    "distributor",
  );

  if (hasDistributorId && hasDistributorName) {
    return {
      ok: false,
      status: 400,
      error: "Provide either distributorId or distributor, not both",
    };
  }

  if (!hasDistributorId && !hasDistributorName) {
    return { ok: true, distributorId: undefined };
  }

  const value = hasDistributorId ? body.distributorId : body.distributor;
  if (value === null || (typeof value === "string" && !value.trim())) {
    return { ok: true, distributorId: null };
  }
  if (typeof value !== "string") {
    return {
      ok: false,
      status: 400,
      error: hasDistributorId
        ? "Distributor ID must be a string"
        : "Distributor must be a string",
    };
  }

  const distributor = hasDistributorId
    ? await prisma.distributor.findUnique({
        where: { id: value.trim() },
        select: { id: true },
      })
    : await prisma.distributor.findUnique({
        where: { name: value.trim() },
        select: { id: true },
      });

  if (!distributor) {
    return {
      ok: false,
      status: 404,
      error: "Distributor not found",
    };
  }

  return { ok: true, distributorId: distributor.id };
};

export class ProductController {
  // Get all products with discount calculation
  static async getAllProducts(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;
      const categoryId = req.query.categoryId as string;
      const minPrice = parseFloat(req.query.minPrice as string);
      const maxPrice = parseFloat(req.query.maxPrice as string);
      const sortBy = (req.query.sortBy as string) || "createdAt";
      const sortOrder = (req.query.sortOrder as string) || "desc";
      const onSale = req.query.onSale === "true";
      const inStockOnly = req.query.inStock === "true";

      // Build filters
      const andFilters: any[] = [];

      if (inStockOnly) {
        andFilters.push({ stock: { gt: 0 } });
      }

      if (categoryId) {
        andFilters.push({ categoryId });
      }

      // Price filtering considering discounts
      if (minPrice || maxPrice) {
        const priceFilter: any = { OR: [{ price: {} }, { discountedPrice: {} }] };
        if (minPrice) {
          priceFilter.OR[0].price.gte = minPrice;
          priceFilter.OR[1].discountedPrice.gte = minPrice;
        }
        if (maxPrice) {
          priceFilter.OR[0].price.lte = maxPrice;
          priceFilter.OR[1].discountedPrice.lte = maxPrice;
        }
        andFilters.push(priceFilter);
      }

      // Filter for products on sale
      if (onSale) {
        andFilters.push({
          OR: [
            { discountedPrice: { not: null } },
            { discountPercent: { gt: 0 } },
          ],
        });
      }

      const where = { AND: andFilters };

      const orderBy: any = {};
      orderBy[sortBy] = sortOrder;

      // Fetch products and total count in parallel for better performance
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
          skip,
          take: limit,
          orderBy,
        }),
        prisma.product.count({ where }),
      ]);

      // Calculate final price for each product
      const productsWithDiscount = products.map((product) => {
        const finalPrice = DiscountService.calculateFinalPrice(
          Number(product.price),
          product.discountedPrice ? Number(product.discountedPrice) : null,
          product.discountPercent,
        );
        const savings = DiscountService.calculateSavings(
          Number(product.price),
          finalPrice,
        );

        return {
          ...formatProductTp(product),
          price: Number(product.price),
          discountedPrice: product.discountedPrice
            ? Number(product.discountedPrice)
            : null,
          finalPrice,
          savings,
          discountBadge: DiscountService.getDiscountBadge(
            Number(product.price),
            finalPrice,
          ),
          discountPercent:
            product.discountPercent ||
            (savings > 0
              ? DiscountService.calculateDiscountPercent(
                  Number(product.price),
                  finalPrice,
                )
              : 0),
        };
      });

      res.status(200).json({
        success: true,
        data: {
          products: productsWithDiscount,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error) {
      console.error("Get products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch products",
      });
    }
  }

  // Get single product with discount calculation
  static async getProductById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const product = await prisma.product.findUnique({
        where: { id },
        include: {
          images: true,
          category: true,
          distributor: {
            select: { name: true },
          },
        },
      });

      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      const finalPrice = DiscountService.calculateFinalPrice(
        Number(product.price),
        product.discountedPrice ? Number(product.discountedPrice) : null,
        product.discountPercent,
      );
      const savings = DiscountService.calculateSavings(
        Number(product.price),
        finalPrice,
      );

      const productWithDiscount = {
        ...formatProductTp(product),
        price: Number(product.price),
        discountedPrice: product.discountedPrice
          ? Number(product.discountedPrice)
          : null,
        finalPrice,
        savings,
        discountBadge: DiscountService.getDiscountBadge(
          Number(product.price),
          finalPrice,
        ),
        discountPercent:
          product.discountPercent ||
          (savings > 0
            ? DiscountService.calculateDiscountPercent(
                Number(product.price),
                finalPrice,
              )
            : 0),
      };

      res.status(200).json({
        success: true,
        data: productWithDiscount,
      });
    } catch (error) {
      console.error("Get product error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch product",
      });
    }
  }

  // Create product with discount support
  static async createProductWithImages(req: AuthRequest, res: Response) {
    try {
      const {
        name,
        description,
        price,
        discountedPrice,
        discountPercent,
        stock,
        categoryId,
        tp,
      } = req.body;

      const files = req.files as Express.Multer.File[];

      // Validation
      if (!name || !description || !price || !categoryId) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: name, description, price, categoryId",
        });
      }

      const parsedPrice = parseFloat(price);
      if (parsedPrice <= 0) {
        return res.status(400).json({
          success: false,
          error: "Price must be greater than 0",
        });
      }

      const distributorInput = await resolveDistributorInput(req.body);
      if (!distributorInput.ok) {
        return res.status(distributorInput.status).json({
          success: false,
          error: distributorInput.error,
        });
      }
      const parsedTp =
        tp == null || (typeof tp === "string" && tp.trim() === "")
          ? null
          : Number(tp);

      // Validate discount
      const parsedDiscountedPrice = discountedPrice
        ? parseFloat(discountedPrice)
        : undefined;
      const parsedDiscountPercent = discountPercent
        ? parseInt(discountPercent)
        : undefined;

      const discountValidation = DiscountService.validateDiscount(
        parsedPrice,
        parsedDiscountedPrice,
        parsedDiscountPercent,
      );

      if (!discountValidation.valid) {
        return res.status(400).json({
          success: false,
          error: discountValidation.error,
        });
      }

      const category = await prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          error: "Category not found",
        });
      }

      // Upload images if provided
      let imageUrls: string[] = [];
      if (files && files.length > 0) {
        imageUrls = await ImageService.uploadMultipleImages(files, "products");
      }

      const product = await prisma.product.create({
        data: {
          name,
          description,
          price: parsedPrice,
          discountedPrice: parsedDiscountedPrice,
          discountPercent: parsedDiscountPercent,
          stock: stock ? parseInt(stock) : 0,
          distributorId: distributorInput.distributorId,
          tp: parsedTp,
          categoryId,
          images:
            imageUrls.length > 0
              ? {
                  create: imageUrls.map((url, index) => ({
                    url,
                    altText: `${name} image ${index + 1}`,
                    isDefault: index === 0,
                  })),
                }
              : undefined,

        },
        include: {
          images: true,
          category: true,
          distributor: {
            select: { name: true },
          },
        },
      });

      const finalPrice = DiscountService.calculateFinalPrice(
        Number(product.price),
        product.discountedPrice ? Number(product.discountedPrice) : null,
        product.discountPercent,
      );

      res.status(201).json({
        success: true,
        data: {
          ...formatProductTp(product),
          price: Number(product.price),
          discountedPrice: product.discountedPrice
            ? Number(product.discountedPrice)
            : null,
          finalPrice,
          savings: DiscountService.calculateSavings(
            Number(product.price),
            finalPrice,
          ),
        },
        message: "Product created successfully",
      });
    } catch (error: any) {
      console.error("Create product error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to create product",
      });
    }
  }

  // Update product with discount support
  static async updateProduct(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        price,
        discountedPrice,
        discountPercent,
        stock,
        categoryId,
        tp,
      } = req.body;

      const files = req.files as Express.Multer.File[];

      const existingProduct = await prisma.product.findUnique({
        where: { id },
        include: { images: true },
      });

      if (!existingProduct) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      if (categoryId) {
        const category = await prisma.category.findUnique({
          where: { id: categoryId },
        });
        if (!category) {
          return res.status(404).json({
            success: false,
            error: "Category not found",
          });
        }
      }

      const parsedPrice = price ? parseFloat(price) : undefined;
      const parsedDiscountedPrice = discountedPrice
        ? parseFloat(discountedPrice)
        : undefined;
      const parsedDiscountPercent = discountPercent
        ? parseInt(discountPercent)
        : undefined;
      const distributorInput = await resolveDistributorInput(req.body);
      if (!distributorInput.ok) {
        return res.status(distributorInput.status).json({
          success: false,
          error: distributorInput.error,
        });
      }
      const parsedTp =
        tp === undefined
          ? undefined
          : tp == null || (typeof tp === "string" && tp.trim() === "")
            ? null
            : Number(tp);

      // Validate discount if price or discount is being updated
      if (
        parsedPrice ||
        parsedDiscountedPrice !== undefined ||
        parsedDiscountPercent !== undefined
      ) {
        const currentPrice = parsedPrice || Number(existingProduct.price);
        const discountValidation = DiscountService.validateDiscount(
          currentPrice,
          parsedDiscountedPrice,
          parsedDiscountPercent,
        );

        if (!discountValidation.valid) {
          return res.status(400).json({
            success: false,
            error: discountValidation.error,
          });
        }
      }

      // Handle new image uploads if any
      let newImagesData = undefined;
      if (files && files.length > 0) {
        const imageUrls = await ImageService.uploadMultipleImages(
          files,
          "products",
        );
        const hasDefault = existingProduct.images.some((img) => img.isDefault);

        newImagesData = {
          create: imageUrls.map((url, index) => ({
            url,
            altText: `${name || existingProduct.name} image`,
            isDefault: !hasDefault && index === 0,
          })),
        };
      }

      const product = await prisma.product.update({
        where: { id },
        data: {
          name: name || undefined,
          description: description || undefined,
          price: parsedPrice,
          discountedPrice: parsedDiscountedPrice,
          discountPercent: parsedDiscountPercent,
          stock: stock !== undefined ? parseInt(stock) : undefined,
          distributorId: distributorInput.distributorId,
          tp: parsedTp,
          categoryId: categoryId || undefined,
          images: newImagesData,
        },
        include: {
          images: true,
          category: true,
          distributor: {
            select: { name: true },
          },
        },
      });

      const finalPrice = DiscountService.calculateFinalPrice(
        Number(product.price),
        product.discountedPrice ? Number(product.discountedPrice) : null,
        product.discountPercent,
      );

      await ProductService.invalidateProductCaches();

      res.status(200).json({
        success: true,
        data: {
          ...formatProductTp(product),
          price: Number(product.price),
          discountedPrice: product.discountedPrice
            ? Number(product.discountedPrice)
            : null,
          finalPrice,
          savings: DiscountService.calculateSavings(
            Number(product.price),
            finalPrice,
          ),
        },
        message: "Product updated successfully",
      });
    } catch (error: any) {
      console.error("Update product error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to update product",
      });
    }
  }

  // Get trending products
  static async getTrendingProducts(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = 20;
      const { products, total } = await ProductService.getTrendingProducts(page);
      res.status(200).json({
        success: true,
        data: {
          products,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error) {
      console.error("Get trending products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch trending products",
      });
    }
  }

  // Get featured products
  static async getFeaturedProducts(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = 20;
      const { products, total } = await ProductService.getFeaturedProducts(
        page,
      );
      res.status(200).json({
        success: true,
        data: {
          products,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error) {
      console.error("Get featured products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch featured products",
      });
    }
  }

  // Get products added in the last 15 days
  static async getNewProducts(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const { products, total } = await ProductService.getNewProducts(
        page,
        limit,
      );

      res.status(200).json({
        success: true,
        data: {
          products: products.map(formatProductTp),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error) {
      console.error("Get new products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch new products",
      });
    }
  }

  // Update trending status
  static async updateTrendingStatus(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { trending } = req.body;

      if (typeof trending !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "Trending status must be a boolean",
        });
      }

      const product = await ProductService.updateTrendingStatus(id, trending);

      res.status(200).json({
        success: true,
        data: product,
        message: "Trending status updated successfully",
      });
    } catch (error: any) {
      console.error("Update trending status error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to update trending status",
      });
    }
  }

  // Update featured status
  static async updateFeaturedStatus(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { featured } = req.body;

      if (typeof featured !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "Featured status must be a boolean",
        });
      }

      const product = await ProductService.updateFeaturedStatus(id, featured);

      res.status(200).json({
        success: true,
        data: product,
        message: "Featured status updated successfully",
      });
    } catch (error: any) {
      console.error("Update featured status error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to update featured status",
      });
    }
  }

  static async addProductImages(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const files = req.files as Express.Multer.File[];

      const product = await prisma.product.findUnique({
        where: { id },
        include: { images: true },
      });

      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      // Upload new images
      const imageUrls = await ImageService.uploadMultipleImages(
        files,
        "products",
      );

      const hasDefault = product.images.some((img) => img.isDefault);

      // Add images to product
      await prisma.productImage.createMany({
        data: imageUrls.map((url, index) => ({
          url,
          altText: `${product.name} image`,
          productId: id,
          isDefault: !hasDefault && index === 0,
        })),
      });

      res.status(200).json({
        success: true,
        data: { added: imageUrls.length },
        message: "Images added successfully",
      });
    } catch (error: any) {
      console.error("Add product images error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to add images",
      });
    }
  }


  static async deleteProductImage(req: AuthRequest, res: Response) {
    try {
      const { productId, imageId } = req.params;

      const image = await prisma.productImage.findFirst({
        where: {
          id: imageId,
          productId: productId,
        },
      });

      if (!image) {
        return res.status(404).json({
          success: false,
          error: "Image not found",
        });
      }

      const wasDefault = image.isDefault;

      // Delete from storage
      await ImageService.deleteImage(image.url);

      // Delete from database
      await prisma.productImage.delete({
        where: { id: imageId },
      });

      // If we deleted the default image, set another one as default if exists
      if (wasDefault) {
        const nextImage = await prisma.productImage.findFirst({
          where: { productId: productId },
        });

        if (nextImage) {
          await prisma.productImage.update({
            where: { id: nextImage.id },
            data: { isDefault: true },
          });
        }
      }

      res.status(200).json({
        success: true,
        message: "Image deleted successfully",
      });
    } catch (error: any) {
      console.error("Delete product image error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to delete image",
      });
    }
  }

  static async setDefaultImage(req: AuthRequest, res: Response) {
    try {
      const { productId, imageId } = req.params;

      // Check if image exists and belongs to the product
      const image = await prisma.productImage.findFirst({
        where: {
          id: imageId,
          productId: productId,
        },
      });

      if (!image) {
        return res.status(404).json({
          success: false,
          error: "Image not found or does not belong to this product",
        });
      }

      // Start a transaction to ensure atomicity
      await prisma.$transaction([
        // Set all images for this product to not default
        prisma.productImage.updateMany({
          where: { productId: productId },
          data: { isDefault: false },
        }),
        // Set the selected image to default
        prisma.productImage.update({
          where: { id: imageId },
          data: { isDefault: true },
        }),
      ]);

      res.status(200).json({
        success: true,
        message: "Default image set successfully",
      });
    } catch (error: any) {
      console.error("Set default image error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to set default image",
      });
    }
  }


  static async searchProducts(req: Request, res: Response) {
    try {
      const { q } = req.query;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      if (!q || typeof q !== "string") {
        return res.status(400).json({
          success: false,
          error: "Search query is required",
        });
      }

      const products = await prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
          stock: { gt: 0 },
        },
        include: {
          images: true,
          category: true,
          distributor: {
            select: { name: true },
          },
        },
        skip,
        take: limit,
        orderBy: { name: "asc" },
      });

      const total = await prisma.product.count({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
          stock: { gt: 0 },
        },
      });

      res.status(200).json({
        success: true,
        data: {
          products: products.map(formatProductTp),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      console.error("Search products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to search products",
      });
    }
  }

  static async createProduct(req: AuthRequest, res: Response) {
    try {
      const {
        name,
        description,
        price,
        stock,
        categoryId,
        images,
        tp,
      } = req.body;

      // Validation
      if (!name || !description || !price || !categoryId) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: name, description, price, categoryId",
        });
      }

      if (price <= 0) {
        return res.status(400).json({
          success: false,
          error: "Price must be greater than 0",
        });
      }

      const distributorInput = await resolveDistributorInput(req.body);
      if (!distributorInput.ok) {
        return res.status(distributorInput.status).json({
          success: false,
          error: distributorInput.error,
        });
      }

      const category = await prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          error: "Category not found",
        });
      }

      const product = await prisma.product.create({
        data: {
          name,
          description,
          price,
          stock: stock || 0,
          distributorId: distributorInput.distributorId,
          tp:
            tp == null || (typeof tp === "string" && tp.trim() === "")
              ? null
              : Number(tp),
          categoryId,
          images:
            images && images.length > 0
              ? {
                  create: images.map((img: any) => ({
                    url: img.url,
                    altText: img.altText,
                  })),
                }
              : undefined,
        },
        include: {
          images: true,
          category: true,
          distributor: {
            select: { name: true },
          },
        },
      });

      await ProductService.invalidateProductCaches();

      res.status(201).json({
        success: true,
        data: formatProductTp(product),
        message: "Product created successfully",
      });
    } catch (error: any) {
      console.error("Create product error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to create product",
      });
    }
  }

  static async deleteProduct(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;

      const product = await prisma.product.findUnique({
        where: { id },
        include: {
          orderItems: {
            take: 1,
          },
        },
      });

      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      if (product.orderItems.length > 0) {
        return res.status(400).json({
          success: false,
          error: "Cannot delete product with existing orders",
        });
      }

      // Delete associated images first
      await prisma.productImage.deleteMany({
        where: { productId: id },
      });

      await prisma.product.delete({
        where: { id },
      });

      await ProductService.invalidateProductCaches();

      res.status(200).json({
        success: true,
        message: "Product deleted successfully",
      });
    } catch (error: any) {
      console.error("Delete product error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to delete product",
      });
    }
  }

  static async updateStock(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { stock, operation } = req.body;

      const product = await prisma.product.findUnique({
        where: { id },
      });

      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      let newStock = stock;
      if (operation === "increment") {
        newStock = product.stock + (stock || 0);
      } else if (operation === "decrement") {
        newStock = product.stock - (stock || 0);
        if (newStock < 0) {
          return res.status(400).json({
            success: false,
            error: "Insufficient stock",
          });
        }
      }

      const updatedProduct = await prisma.product.update({
        where: { id },
        data: { stock: newStock },
        include: {
          distributor: {
            select: { name: true },
          },
        },
      });

      await ProductService.invalidateProductCaches();

      res.status(200).json({
        success: true,
        data: formatProductTp(updatedProduct),
        message: "Stock updated successfully",
      });
    } catch (error) {
      console.error("Update stock error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update stock",
      });
    }
  }

  static async getLowStockProducts(req: AuthRequest, res: Response) {
    try {
      const { page, limit, skip } = parseStockStatusPagination(req.query);
      const where = {
        stock: {
          gt: 0,
          lte: 20,
        },
      };

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            category: true,
            images: true,
            distributor: {
              select: { name: true },
            },
          },
          orderBy: [{ stock: "asc" }, { id: "asc" }],
          skip,
          take: limit,
        }),
        prisma.product.count({ where }),
      ]);

      res.status(200).json({
        success: true,
        data: {
          products: products.map(formatProductTp),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error) {
      console.error("Get low stock products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch low stock products",
      });
    }
  }

  static async getOutOfStockProducts(req: AuthRequest, res: Response) {
    try {
      const { page, limit, skip } = parseStockStatusPagination(req.query);
      const where = { stock: 0 };

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            category: true,
            images: true,
            distributor: {
              select: { name: true },
            },
          },
          orderBy: { id: "asc" },
          skip,
          take: limit,
        }),
        prisma.product.count({ where }),
      ]);

      res.status(200).json({
        success: true,
        data: {
          products: products.map(formatProductTp),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error) {
      console.error("Get out of stock products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch out of stock products",
      });
    }
  }
}
