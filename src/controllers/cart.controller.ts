import { Response } from "express";
import { prisma } from "../config/supabase";
import { AuthRequest } from "../middleware/auth.middleware";
import { DiscountService } from "../services/discount.service";

export class CartController {
  // ── addToCart ─────────────────────────────────────────────
  // Optimized: single Prisma transaction replaces 3-4 sequential queries
  static async addToCart(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const { productId, quantity } = req.body;

      if (!productId || !quantity || quantity < 1) {
        return res.status(400).json({
          success: false,
          error: "Product ID and valid quantity are required",
        });
      }

      // Single transaction: validate product, upsert cart + item
      const result = await prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { id: true, stock: true, price: true, discountedPrice: true, discountPercent: true },
        });

        if (!product) throw { status: 404, message: "Product not found" };
        if (product.stock < quantity) throw { status: 400, message: "Insufficient stock" };

        // upsert cart in one query
        const cart = await tx.cart.upsert({
          where: { userId },
          create: { userId },
          update: {},
          select: { id: true },
        });

        // upsert cart item in one query
        await tx.cartItem.upsert({
          where: { cartId_productId: { cartId: cart.id, productId } },
          create: { cartId: cart.id, productId, quantity },
          update: { quantity: { increment: quantity } },
        });

        return true;
      });

      res.status(200).json({
        success: true,
        message: "Product added to cart successfully",
      });
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ success: false, error: error.message });
      }
      console.error("Add to cart error:", error);
      res.status(500).json({ success: false, error: "Failed to add to cart" });
    }
  }

  // ── getCart ───────────────────────────────────────────────
  // Optimized: uses select instead of full include, single query
  static async getCart(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;

      const cart = await prisma.cart.findUnique({
        where: { userId },
        select: {
          items: {
            select: {
              id: true,
              quantity: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  price: true,
                  discountedPrice: true,
                  discountPercent: true,
                  stock: true,
                   categoryId: true,
                  category: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                  images: {
                    where: { isDefault: true },
                    select: { id: true, url: true, altText: true, isDefault: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });

      if (!cart || cart.items.length === 0) {
        return res.status(200).json({
          success: true,
          data: { items: [], subtotal: 0, totalSavings: 0, total: 0, itemCount: 0 },
        });
      }

      // Calculate cart totals with discounts
      let subtotal = 0;
      let totalSavings = 0;

      const cartItems = cart.items.map((item) => {
        const originalPrice = Number(item.product.price);
        const finalPrice = DiscountService.calculateFinalPrice(
          originalPrice,
          item.product.discountedPrice ? Number(item.product.discountedPrice) : null,
          item.product.discountPercent,
        );
        const itemTotal = finalPrice * item.quantity;
        const itemOriginalTotal = originalPrice * item.quantity;
        const itemSavings = itemOriginalTotal - itemTotal;

        subtotal += itemOriginalTotal;
        totalSavings += itemSavings;

        return {
          id: item.id,
          quantity: item.quantity,
          product: {
            ...item.product,
            price: originalPrice,
            discountedPrice: item.product.discountedPrice
              ? Number(item.product.discountedPrice)
              : null,
            finalPrice,
            discountPercent:
              item.product.discountPercent ||
              DiscountService.calculateDiscountPercent(originalPrice, finalPrice),
          },
          itemTotal,
          itemSavings,
        };
      });

      res.status(200).json({
        success: true,
        data: {
          items: cartItems,
          subtotal,
          totalSavings,
          total: subtotal - totalSavings,
          itemCount: cartItems.reduce((sum, item) => sum + item.quantity, 0),
        },
      });
    } catch (error) {
      console.error("Get cart error:", error);
      res.status(500).json({ success: false, error: "Failed to fetch cart" });
    }
  }

  // ── updateCartItem ───────────────────────────────────────
  // Optimized: single transaction, findUnique on userId
  static async updateCartItem(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const { itemId } = req.params;
      const { quantity } = req.body;

      if (!quantity || quantity < 1) {
        return res.status(400).json({ error: "Valid quantity is required" });
      }

      const updatedItem = await prisma.$transaction(async (tx) => {
        // Single query: find cart item and verify ownership + get stock
        const cartItem = await tx.cartItem.findFirst({
          where: {
            id: itemId,
            cart: { userId },
          },
          select: { id: true, product: { select: { stock: true } } },
        });

        if (!cartItem) throw { status: 404, message: "Cart item not found" };
        if (cartItem.product.stock < quantity) {
          throw { status: 400, message: `Insufficient stock. Available: ${cartItem.product.stock}` };
        }

        return tx.cartItem.update({
          where: { id: itemId },
          data: { quantity },
          select: { id: true, quantity: true, productId: true },
        });
      });

      res.status(200).json({
        success: true,
        message: "Cart item updated successfully",
        data: updatedItem,
      });
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ success: false, error: error.message });
      }
      console.error("Update cart item error:", error);
      res.status(400).json({ error: error.message || "Failed to update cart item" });
    }
  }

  // ── removeFromCart ───────────────────────────────────────
  // Optimized: verify ownership + delete in single transaction
  static async removeFromCart(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const { itemId } = req.params;

      await prisma.$transaction(async (tx) => {
        // Verify the item belongs to user's cart
        const cartItem = await tx.cartItem.findFirst({
          where: {
            id: itemId,
            cart: { userId },
          },
          select: { id: true },
        });

        if (!cartItem) throw { status: 404, message: "Cart item not found" };

        await tx.cartItem.delete({ where: { id: itemId } });
      });

      res.status(200).json({
        success: true,
        message: "Item removed from cart successfully",
      });
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ success: false, error: error.message });
      }
      console.error("Remove from cart error:", error);
      res.status(400).json({ error: error.message || "Failed to remove item from cart" });
    }
  }

  // ── clearCart ─────────────────────────────────────────────
  // Optimized: single query using nested relation filter, no separate findFirst
  static async clearCart(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;

      const deleted = await prisma.cartItem.deleteMany({
        where: { cart: { userId } },
      });

      res.status(200).json({
        success: true,
        message: `Cart cleared successfully (${deleted.count} items removed)`,
      });
    } catch (error: any) {
      console.error("Clear cart error:", error);
      res.status(400).json({ error: error.message || "Failed to clear cart" });
    }
  }

  // ── getCartItemCount ──────────────────────────────────────
  // Optimized: uses aggregate instead of fetching all items
  static async getCartItemCount(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;

      const result = await prisma.cartItem.aggregate({
        where: { cart: { userId } },
        _sum: { quantity: true },
      });

      res.status(200).json({
        success: true,
        message: "Cart item count fetched successfully",
        data: { count: result._sum.quantity || 0 },
      });
    } catch (error: any) {
      console.error("Get cart item count error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch cart item count" });
    }
  }
}
