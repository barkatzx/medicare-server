// src/controllers/category.controller.ts
import { Request, Response } from "express";
import { prisma } from "../config/supabase";
import { DiscountService } from "../services/discount.service";
import { AuthRequest } from "../types";

const hasPrismaErrorCode = (error: unknown, code: string) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === code;

export class CategoryController {
  static async getAllCategories(req: Request, res: Response) {
    try {
      const categories = await prisma.category.findMany({
        include: {
          _count: {
            select: { products: true },
          },
        },
        orderBy: {
          name: "asc",
        },
      });

      res.status(200).json({
        success: true,
        data: categories,
      });
    } catch (error) {
      console.error("Get categories error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch categories",
      });
    }
  }

  static async getCategoryById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const category = await prisma.category.findUnique({
        where: { id },
        include: {
          products: {
            where: { stock: { gt: 0 } },
            take: 20,
            orderBy: { createdAt: "desc" },
            include: {
              distributor: {
                select: { name: true },
              },
            },
          },
        },
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          error: "Category not found",
        });
      }

      res.status(200).json({
        success: true,
        data: {
          ...category,
          products: category.products.map((product) => ({
            ...product,
            distributor: product.distributor?.name ?? null,
          })),
        },
      });
    } catch (error) {
      console.error("Get category error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch category",
      });
    }
  }

  static async getCategoryProducts(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const category = await prisma.category.findUnique({
        where: { id },
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          error: "Category not found",
        });
      }

      const products = await prisma.product.findMany({
        where: {
          categoryId: id,
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
        orderBy: { createdAt: "desc" },
      });

      const total = await prisma.product.count({
        where: {
          categoryId: id,
          stock: { gt: 0 },
        },
      });

      res.status(200).json({
        success: true,
        data: {
          products: products.map((product) => ({
            ...product,
            distributor: product.distributor?.name ?? null,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      console.error("Get category products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch category products",
      });
    }
  }

  static async createCategory(req: AuthRequest, res: Response) {
    try {
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          error: "Category name is required",
        });
      }

      const existingCategory = await prisma.category.findUnique({
        where: { name },
      });

      if (existingCategory) {
        return res.status(400).json({
          success: false,
          error: "Category with this name already exists",
        });
      }

      const category = await prisma.category.create({
        data: {
          name,
          description,
        },
      });

      res.status(201).json({
        success: true,
        data: category,
        message: "Category created successfully",
      });
    } catch (error) {
      console.error("Create category error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create category",
      });
    }
  }

  static async updateCategory(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { name, description } = req.body;

      const existingCategory = await prisma.category.findUnique({
        where: { id },
      });

      if (!existingCategory) {
        return res.status(404).json({
          success: false,
          error: "Category not found",
        });
      }

      if (name && name !== existingCategory.name) {
        const nameExists = await prisma.category.findUnique({
          where: { name },
        });
        if (nameExists) {
          return res.status(400).json({
            success: false,
            error: "Category with this name already exists",
          });
        }
      }

      const category = await prisma.category.update({
        where: { id },
        data: {
          name: name || undefined,
          description: description !== undefined ? description : undefined,
        },
      });

      res.status(200).json({
        success: true,
        data: category,
        message: "Category updated successfully",
      });
    } catch (error) {
      console.error("Update category error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update category",
      });
    }
  }

  static async deleteCategory(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;

      const category = await prisma.category.findUnique({
        where: { id },
        include: {
          products: {
            take: 1,
          },
        },
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          error: "Category not found",
        });
      }

      if (category.products.length > 0) {
        return res.status(400).json({
          success: false,
          error: "Cannot delete category with existing products",
        });
      }

      await prisma.category.delete({
        where: { id },
      });

      res.status(200).json({
        success: true,
        message: "Category deleted successfully",
      });
    } catch (error) {
      console.error("Delete category error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete category",
      });
    }
  }

  static async getAllDistributor(_req: Request, res: Response) {
    try {
      const distributors = await prisma.distributor.findMany({
        orderBy: { name: "asc" },
      });

      return res.status(200).json({
        success: true,
        data: distributors,
      });
    } catch (error) {
      console.error("Get distributors error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch distributors",
      });
    }
  }

  static async createDistributor(req: AuthRequest, res: Response) {
    try {
      const body = req.body;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => key !== "name")
      ) {
        return res.status(400).json({
          success: false,
          error: "Only the name field is allowed",
        });
      }

      if (typeof body.name !== "string" || !body.name.trim()) {
        return res.status(400).json({
          success: false,
          error: "Distributor name is required",
        });
      }

      const name = body.name.trim();
      const existingDistributor = await prisma.distributor.findUnique({
        where: { name },
      });
      if (existingDistributor) {
        return res.status(409).json({
          success: false,
          error: "Distributor with this name already exists",
        });
      }

      const distributor = await prisma.distributor.create({
        data: { name },
      });

      return res.status(201).json({
        success: true,
        data: distributor,
        message: "Distributor created successfully",
      });
    } catch (error) {
      console.error("Create distributor error:", error);
      if (hasPrismaErrorCode(error, "P2002")) {
        return res.status(409).json({
          success: false,
          error: "Distributor with this name already exists",
        });
      }
      return res.status(500).json({
        success: false,
        error: "Failed to create distributor",
      });
    }
  }

  static async getDristributorById(req: Request, res: Response) {
    try {
      const distributor = await prisma.distributor.findUnique({
        where: { id: req.params.id },
      });

      if (!distributor) {
        return res.status(404).json({
          success: false,
          error: "Distributor not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: distributor,
      });
    } catch (error) {
      console.error("Get distributor error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch distributor",
      });
    }
  }

  static async updateDistributor(req: AuthRequest, res: Response) {
    try {
      const body = req.body;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => key !== "name")
      ) {
        return res.status(400).json({
          success: false,
          error: "Only the name field is allowed",
        });
      }
      if (typeof body.name !== "string" || !body.name.trim()) {
        return res.status(400).json({
          success: false,
          error: "Distributor name is required",
        });
      }

      const { id } = req.params;
      const existingDistributor = await prisma.distributor.findUnique({
        where: { id },
      });
      if (!existingDistributor) {
        return res.status(404).json({
          success: false,
          error: "Distributor not found",
        });
      }

      const name = body.name.trim();
      const distributorWithName = await prisma.distributor.findUnique({
        where: { name },
      });
      if (distributorWithName && distributorWithName.id !== id) {
        return res.status(409).json({
          success: false,
          error: "Distributor with this name already exists",
        });
      }

      const distributor = await prisma.distributor.update({
        where: { id },
        data: { name },
      });

      return res.status(200).json({
        success: true,
        data: distributor,
        message: "Distributor updated successfully",
      });
    } catch (error) {
      console.error("Update distributor error:", error);
      if (hasPrismaErrorCode(error, "P2002")) {
        return res.status(409).json({
          success: false,
          error: "Distributor with this name already exists",
        });
      }
      if (hasPrismaErrorCode(error, "P2025")) {
        return res.status(404).json({
          success: false,
          error: "Distributor not found",
        });
      }
      return res.status(500).json({
        success: false,
        error: "Failed to update distributor",
      });
    }
  }

  static async deleteDistributor(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const distributor = await prisma.distributor.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!distributor) {
        return res.status(404).json({
          success: false,
          error: "Distributor not found",
        });
      }

      const productCount = await prisma.product.count({
        where: { distributorId: id },
      });
      if (productCount > 0) {
        return res.status(409).json({
          success: false,
          error: "Cannot delete distributor with associated products",
        });
      }

      await prisma.distributor.delete({ where: { id } });

      return res.status(200).json({
        success: true,
        message: "Distributor deleted successfully",
      });
    } catch (error) {
      console.error("Delete distributor error:", error);
      if (hasPrismaErrorCode(error, "P2003")) {
        return res.status(409).json({
          success: false,
          error: "Cannot delete distributor with associated products",
        });
      }
      if (hasPrismaErrorCode(error, "P2025")) {
        return res.status(404).json({
          success: false,
          error: "Distributor not found",
        });
      }
      return res.status(500).json({
        success: false,
        error: "Failed to delete distributor",
      });
    }
  }

  static async getDristributorProducts(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const distributor = await prisma.distributor.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!distributor) {
        return res.status(404).json({
          success: false,
          error: "Distributor not found",
        });
      }

      const where = { distributorId: id };
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
          orderBy: { createdAt: "desc" },
        }),
        prisma.product.count({ where }),
      ]);

      const formattedProducts = products.map((product) => {
        const price = Number(product.price);
        const discountedPrice =
          product.discountedPrice == null
            ? null
            : Number(product.discountedPrice);
        const finalPrice = DiscountService.calculateFinalPrice(
          price,
          discountedPrice,
          product.discountPercent,
        );
        const savings = DiscountService.calculateSavings(price, finalPrice);

        return {
          ...product,
          price,
          discountedPrice,
          distributor: product.distributor?.name ?? null,
          tp: product.tp == null ? null : Number(product.tp),
          finalPrice,
          savings,
          discountBadge: DiscountService.getDiscountBadge(price, finalPrice),
          discountPercent:
            product.discountPercent ||
            (savings > 0
              ? DiscountService.calculateDiscountPercent(price, finalPrice)
              : 0),
        };
      });

      return res.status(200).json({
        success: true,
        data: {
          products: formattedProducts,
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
      console.error("Get distributor products error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch distributor products",
      });
    }
  }
}
