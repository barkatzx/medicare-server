// src/controllers/order.controller.ts
import { Response } from "express";
import { prisma } from "../config/supabase";
import { DiscountService } from "../services/discount.service";
import { invalidateOrderDataCaches } from "../services/cache.service";
import { AuthRequest } from "../types";
import { NotificationService } from "../notifications/notifications.service";

interface CreateOrderBody {
  shippingAddressId: string;
  paymentMethod?: "cod";
}

interface UpdateOrderStatusBody {
  status: "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";
}

export class OrderController {
  static async createOrder(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const { paymentMethod = "cod" } = req.body as CreateOrderBody;
      let shippingAddressId = req.body.shippingAddressId as string | undefined;

      // v1 apps send shippingAddressId; v2 apps use location 2.0 (user profile)
      let address = shippingAddressId
        ? await prisma.address.findFirst({
            where: { id: shippingAddressId, userId },
          })
        : null;

      if (!address) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          include: { division: true, district: true, upazila: true },
        });

        const street = (req.body.fullAddress ?? user?.fullAddress ?? "")
          .toString()
          .trim();

        if (!street) {
          return res.status(400).json({
            success: false,
            error: shippingAddressId
              ? "Shipping address not found"
              : "Shipping address is required",
          });
        }

        const city = user?.upazila?.name ?? user?.district?.name ?? "N/A";
        const state =
          [user?.district?.name, user?.division?.name]
            .filter(Boolean)
            .join(", ") || null;

        address =
          (await prisma.address.findFirst({
            where: { userId, street, city, state, country: "" },
          })) ??
          (await prisma.address.create({
            data: { userId, street, city, state, country: "" },
          }));
        shippingAddressId = address.id;
      }
      // Get user's cart with items
      const cart = await prisma.cart.findUnique({
        where: { userId },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      if (!cart || cart.items.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Cart is empty",
        });
      }
      // Check stock availability and calculate totals with discounts
      let totalAmount = 0;
      let totalOriginalAmount = 0;

      // Pre-calculate items data and verify stock
      const orderItemsData = cart.items.map((item) => {
        if (item.quantity > item.product.stock) {
          throw new Error(
            `Insufficient stock for product: ${item.product.name}. Available: ${item.product.stock}`,
          );
        }

        const originalPrice = Number(item.product.price);
        const finalPrice = DiscountService.calculateFinalPrice(
          originalPrice,
          item.product.discountedPrice
            ? Number(item.product.discountedPrice)
            : null,
          item.product.discountPercent,
        );

        const itemTotal = finalPrice * item.quantity;
        const itemOriginalTotal = originalPrice * item.quantity;

        totalAmount += itemTotal;
        totalOriginalAmount += itemOriginalTotal;

        return {
          productId: item.productId,
          quantity: item.quantity,
          price: Math.round(finalPrice * 100) / 100,
        };
      });

      // Round totals to 2 decimal places to avoid floating point issues
      totalAmount = Math.round(totalAmount * 100) / 100;
      totalOriginalAmount = Math.round(totalOriginalAmount * 100) / 100;

      // Create order with transaction with significantly increased timeout for massive orders (up to 500+ items)
      const result = await prisma.$transaction(
        async (tx) => {
          // Create order with all items in one nested operation
          const order = await tx.order.create({
            data: {
              userId,
              shippingAddressId: address.id,
              totalAmount,
              status: "pending",
              items: {
                create: orderItemsData,
              },
              payment: {
                create: {
                  method: paymentMethod,
                  status: "pending",
                },
              },
            },
            include: {
              items: {
                include: {
                  product: true,
                },
              },
              payment: true,
              shippingAddress: true,
            },
          });

          // Update product stock in batches to avoid connection pool exhaustion
          // and handle large orders (100-500+ products) efficiently
          // Using a balanced batch size for optimal performance and stability
          const batchSize = 50;
          for (let i = 0; i < cart.items.length; i += batchSize) {
            const batch = cart.items.slice(i, i + batchSize);
            await Promise.all(
              batch.map((item) =>
                tx.product.update({
                  where: { id: item.productId },
                  data: {
                    stock: {
                      decrement: item.quantity,
                    },
                  },
                }),
              ),
            );
          }

          // Clear cart
          await tx.cartItem.deleteMany({
            where: { cartId: cart.id },
          });

          // Create notification with savings info
          const totalSavings = totalOriginalAmount - totalAmount;
          const savingsMessage =
            totalSavings > 0 ? ` You saved ${totalSavings.toFixed(2)}৳!` : "";

          const notification = await tx.notification.create({
            data: {
              userId,
              title: "Order Placed Successfully",
              message: `Your order #${order.id} has been placed successfully. Total amount: ${totalAmount}${savingsMessage}৳`,
              type: "order",
            },
            select: {
              id: true,
              userId: true,
              title: true,
              message: true,
              type: true,
              photo: true,
            },
          });

          return { order, notification };
        },
        {
          timeout: 300000, // 300 seconds (5 minutes) timeout to handle massive orders (100-500+ products)
        },
      );

      await NotificationService.pushSavedNotification(result.notification);

      await invalidateOrderDataCaches();

      return res.status(201).json({
        success: true,
        data: result.order,
        message: "Order created successfully",
      });
    } catch (error: any) {
      console.error("Create order error details:", error);

      // Handle specific stock error thrown above
      if (error.message && error.message.startsWith("Insufficient stock")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error:
          "Failed to create order due to heavy processing load. We are processing a large number of items. Please check 'My Orders' in a moment or try again.",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
  static async getMyOrders(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;
      const status = req.query.status as string;

      const where: any = { userId };
      if (status) {
        where.status = status;
      }

      const orders = await prisma.order.findMany({
        where,
        include: {
          items: {
            include: {
              product: {
                include: {
                  images: true,
                },
              },
            },
          },
          payment: true,
          shippingAddress: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      });

      const total = await prisma.order.count({ where });

      res.status(200).json({
        success: true,
        data: {
          orders,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      console.error("Get my orders error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch orders",
      });
    }
  }

  static async getMyOrderById(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const { orderId } = req.params;

      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          userId,
        },
        include: {
          items: {
            include: {
              product: {
                include: {
                  images: true,
                },
              },
            },
          },
          payment: true,
          shippingAddress: true,
        },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error) {
      console.error("Get order by id error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch order",
      });
    }
  }

  static async cancelOrder(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const { orderId } = req.params;

      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          userId,
        },
        include: {
          items: true,
        },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      if (order.status !== "pending") {
        return res.status(400).json({
          success: false,
          error: `Cannot cancel order with status: ${order.status}`,
        });
      }

      // Cancel order and restore stock
      const result = await prisma.$transaction(async (tx) => {
        // Restore product stock
        // Restore product stock in parallel
        await Promise.all(
          order.items.map((item) =>
            tx.product.update({
              where: { id: item.productId },
              data: {
                stock: {
                  increment: item.quantity,
                },
              },
            }),
          ),
        );

        // Update order status
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: { status: "cancelled" },
        });

        // Update payment status
        await tx.payment.update({
          where: { orderId },
          data: { status: "failed" },
        });

        // Create notification
        const notification = await tx.notification.create({
          data: {
            userId,
            title: "Order Cancelled",
            message: `Your order #${orderId} has been cancelled.`,
            type: "order",
          },
          select: {
            id: true,
            userId: true,
            title: true,
            message: true,
            type: true,
            photo: true,
          },
        });

        return { order: updatedOrder, notification };
      });

      await NotificationService.pushSavedNotification(result.notification);

      await invalidateOrderDataCaches();

      res.status(200).json({
        success: true,
        data: result.order,
        message: "Order cancelled successfully",
      });
    } catch (error) {
      console.error("Cancel order error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to cancel order",
      });
    }
  }

  static async getAllOrders(req: AuthRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;
      const status = req.query.status as string;

      const where: any = {};
      if (status) {
        where.status = status;
      }

      // Order ID is the UUID primary key; search by full ID or trailing 8+ chars
      if (req.query.search !== undefined) {
        if (typeof req.query.search !== "string") {
          return res.status(400).json({
            success: false,
            error: "Invalid search parameter",
          });
        }
        const search = req.query.search.trim().replace(/^#/, "");
        if (search) {
          if (!/^[0-9a-fA-F-]{8,36}$/.test(search)) {
            return res.status(400).json({
              success: false,
              error:
                "Search must be the last 8 characters (or more) of an Order ID",
            });
          }
          where.id = { endsWith: search.toLowerCase() };
        }
      }

      const orders = await prisma.order.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone_number: true,
              pharmacy_name: true,
            },
          },
          items: {
            include: {
              product: true,
            },
          },
          payment: true,
          shippingAddress: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      });

      const total = await prisma.order.count({ where });

      res.status(200).json({
        success: true,
        data: {
          orders,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      console.error("Get all orders error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch orders",
      });
    }
  }

  static async getOrderById(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone_number: true,
              pharmacy_name: true,
            },
          },
          items: {
            include: {
              product: {
                include: {
                  images: true,
                },
              },
            },
          },
          payment: true,
          shippingAddress: true,
        },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error) {
      console.error("Get order by id error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch order",
      });
    }
  }

  static async updateOrderStatus(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;
      const { status } = req.body as UpdateOrderStatusBody;

      const validStatuses = [
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid status",
        });
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: true,
        },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: { status },
      });
      await invalidateOrderDataCaches();

      // Create notification for user
      const notification = await prisma.notification.create({
        data: {
          userId: order.userId,
          title: `Order Status Updated`,
          message: `Your order #${orderId} status has been updated to: ${status}`,
          type: "order",
        },
        select: {
          id: true,
          userId: true,
          title: true,
          message: true,
          type: true,
          photo: true,
        },
      });
      await NotificationService.pushSavedNotification(notification);

      res.status(200).json({
        success: true,
        data: updatedOrder,
        message: "Order status updated successfully",
      });
    } catch (error) {
      console.error("Update order status error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update order status",
      });
    }
  }

  static async confirmPaymentCOD(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          payment: true,
        },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      if (order.payment?.status === "paid") {
        return res.status(400).json({
          success: false,
          error: "Payment already confirmed",
        });
      }

      const updatedPayment = await prisma.payment.update({
        where: { orderId },
        data: {
          status: "paid",
          paidAt: new Date(),
        },
      });
      await invalidateOrderDataCaches();

      // Create notification
      const notification = await prisma.notification.create({
        data: {
          userId: order.userId,
          title: "Payment Confirmed",
          message: `Your payment for order #${orderId} has been confirmed.`,
          type: "order",
        },
        select: {
          id: true,
          userId: true,
          title: true,
          message: true,
          type: true,
          photo: true,
        },
      });
      await NotificationService.pushSavedNotification(notification);

      res.status(200).json({
        success: true,
        data: updatedPayment,
        message: "Payment confirmed successfully",
      });
    } catch (error) {
      console.error("Confirm payment error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to confirm payment",
      });
    }
  }
}
