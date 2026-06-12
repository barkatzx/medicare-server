import { Request, Response } from "express";
import { prisma } from "../config/supabase";
import { AuthRequest } from "../middleware/auth.middleware";
import { AuthService } from "../services/auth.service";
import redisClient from "../config/redis";
interface AddressInput {
  street: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  isDefault?: boolean;
}

interface SendNotificationInput {
  userId: string;
  title: string;
  message: string;
  type: "order" | "approval" | "system";
}

const VALID_ROLES = ["admin", "customer"] as const;
const VALID_NOTIFICATION_TYPES = ["order", "approval", "system"] as const;
type ValidRole = (typeof VALID_ROLES)[number];
type ValidNotificationType = (typeof VALID_NOTIFICATION_TYPES)[number];

export class UserController {
  // Register new user
  static async register(req: Request, res: Response) {
    try {
      const { email, phone_number, name, pharmacy_name, password, role } =
        req.body;

      if (!email || !phone_number || !password) {
        return res.status(400).json({
          error: "Email, phone number, and password are required",
        });
      }

      const result = await AuthService.register({
        email,
        phone_number,
        name,
        pharmacy_name,
        password,
        role,
      });

      res.status(201).json({
        message: "User registered successfully",
        data: result,
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      res.status(400).json({ error: error.message || "Registration failed" });
    }
  }

  // Login user
  static async login(req: Request, res: Response) {
    try {
      const { email, phone_number, password } = req.body;

      // Validate that either email or phone_number is provided
      if ((!email && !phone_number) || !password) {
        return res.status(400).json({
          error:
            "Either email or phone number is required, along with password",
        });
      }

      const result = await AuthService.login({ email, phone_number, password });
      res.status(200).json({ message: "Login successful", data: result });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(401).json({ error: error.message || "Login failed" });
    }
  }

  // Get current user profile
  static async getProfile(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          phone_number: true,
          name: true,
          pharmacy_name: true,
          role: true,
          isApproved: true,
          createdAt: true,
          defaultAddressId: true,
          addresses: {
            orderBy: { createdAt: "desc" },
          },
          notifications: {
            where: { isRead: false },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res
        .status(200)
        .json({ message: "Profile fetched successfully", data: user });
    } catch (error: any) {
      console.error("Get profile error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch profile" });
    }
  }

  // Update user profile
  static async updateProfile(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { name, pharmacy_name, phone_number } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const data: Record<string, any> = {};
      if (name !== undefined) data.name = name;
      if (pharmacy_name !== undefined) data.pharmacy_name = pharmacy_name;
      if (phone_number !== undefined) data.phone_number = phone_number;

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          email: true,
          phone_number: true,
          name: true,
          pharmacy_name: true,
          role: true,
          isApproved: true,
        },
      });

      res.status(200).json({
        message: "Profile updated successfully",
        data: updatedUser,
      });
    } catch (error: any) {
      console.error("Update profile error:", error);
      res
        .status(400)
        .json({ error: error.message || "Failed to update profile" });
    }
  }

  // Delete user profile
  static async deleteProfile(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      await prisma.user.delete({
        where: { id: userId },
      });

      // Clear user's Redis cache
      try {
        const keys = await redisClient.keys(`cache:${userId}:*`);
        if (keys.length > 0) {
          await redisClient.del(...keys);
          console.log(`[Cache] DELETED ${keys.length} keys for user ${userId}`);
        }
      } catch (redisError) {
        console.error(
          "Redis Cache Invalidation Error on Profile Delete:",
          redisError,
        );
      }

      res.status(200).json({ message: "User profile deleted successfully" });
    } catch (error: any) {
      console.error("Delete profile error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to delete profile" });
    }
  }

  // Change password
  static async changePassword(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { oldPassword, newPassword } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      if (!oldPassword || !newPassword) {
        return res.status(400).json({
          error: "Old password and new password are required",
        });
      }

      const result = await AuthService.changePassword(
        userId,
        oldPassword,
        newPassword,
      );
      res.status(200).json(result);
    } catch (error: any) {
      console.error("Change password error:", error);
      res
        .status(400)
        .json({ error: error.message || "Failed to change password" });
    }
  }

  // Get all users (admin only)
  static async getAllUsers(req: AuthRequest, res: Response) {
    try {
      const { page = 1, limit = 20, role, isApproved } = req.query; // ← limit default: 10 → 20

      const where: Record<string, any> = {};

      if (role !== undefined) {
        if (!VALID_ROLES.includes(role as ValidRole)) {
          return res.status(400).json({
            error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
          });
        }
        where.role = role;
      }

      if (isApproved !== undefined) {
        where.isApproved = isApproved === "true";
      }

      const pageNum = Number(page);
      const limitNum = Number(limit);

      const [users, total] = await prisma.$transaction([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            phone_number: true,
            name: true,
            pharmacy_name: true,
            role: true,
            isApproved: true,
            createdAt: true,
          },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
          orderBy: { createdAt: "desc" },
        }),
        prisma.user.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limitNum);

      res.status(200).json({
        message: "Users fetched successfully",
        data: {
          users,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: totalPages,
            hasNextPage: pageNum < totalPages,
            hasPrevPage: pageNum > 1,
          },
        },
      });
    } catch (error: any) {
      console.error("Get all users error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch users" });
    }
  }

  // Approve user (admin only)
  static async approveUser(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      const userExists = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isApproved: true,
        },
      });

      if (!userExists) {
        return res.status(404).json({ error: "User not found" });
      }

      if (userExists.isApproved) {
        return res.status(400).json({ error: "User is already approved" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: userId },
          data: { isApproved: true },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isApproved: true,
          },
        });

        await tx.notification.create({
          data: {
            userId,
            title: "Account Approved",
            message:
              "Your account has been approved. You can now log in and start shopping.",
            type: "approval",
          },
        });

        return user;
      });

      res
        .status(200)
        .json({ message: "User approved successfully", data: result });
    } catch (error: any) {
      console.error("Approve user error:", error);
      res
        .status(400)
        .json({ error: error.message || "Failed to approve user" });
    }
  }

  // Send notification to user (admin only)
  static async sendNotification(req: AuthRequest, res: Response) {
    try {
      const { userId, title, message, type }: SendNotificationInput = req.body;

      if (!userId || !title || !message || !type) {
        return res.status(400).json({
          error: "userId, title, message, and type are required",
        });
      }

      if (!VALID_NOTIFICATION_TYPES.includes(type as ValidNotificationType)) {
        return res.status(400).json({
          error: `Invalid notification type. Must be one of: ${VALID_NOTIFICATION_TYPES.join(", ")}`,
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const notification = await prisma.notification.create({
        data: { userId, title, message, type },
      });

      res.status(201).json({
        message: "Notification sent successfully",
        data: notification,
      });
    } catch (error: any) {
      console.error("Send notification error:", error);
      res
        .status(400)
        .json({ error: error.message || "Failed to send notification" });
    }
  }

  // Send bulk notifications (admin only)
  static async sendBulkNotifications(req: AuthRequest, res: Response) {
    try {
      const { userIds, title, message, type } = req.body;

      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          error: "userIds array is required and cannot be empty",
        });
      }

      if (!title || !message || !type) {
        return res
          .status(400)
          .json({ error: "title, message, and type are required" });
      }

      if (!VALID_NOTIFICATION_TYPES.includes(type as ValidNotificationType)) {
        return res.status(400).json({
          error: `Invalid notification type. Must be one of: ${VALID_NOTIFICATION_TYPES.join(", ")}`,
        });
      }

      const existingUsers = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true },
      });

      const existingIds = new Set(existingUsers.map((u) => u.id));
      const missingIds = userIds.filter((id: string) => !existingIds.has(id));

      if (missingIds.length > 0) {
        return res.status(404).json({
          error: "Some users not found",
          data: { missingIds },
        });
      }

      const notifications = await prisma.$transaction(
        userIds.map((userId: string) =>
          prisma.notification.create({
            data: { userId, title, message, type },
          }),
        ),
      );

      res.status(201).json({
        message: `Notifications sent to ${notifications.length} users successfully`,
        data: { count: notifications.length, notifications },
      });
    } catch (error: any) {
      console.error("Send bulk notifications error:", error);
      res.status(400).json({
        error: error.message || "Failed to send bulk notifications",
      });
    }
  }

  // Get user's addresses
  static async getAddresses(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const addresses = await prisma.address.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      res.status(200).json({
        message: "Addresses fetched successfully",
        data: addresses,
      });
    } catch (error: any) {
      console.error("Get addresses error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch addresses" });
    }
  }

  // Add new address
  static async addAddress(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const addressData: AddressInput = req.body;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      if (!addressData.street || !addressData.city || !addressData.country) {
        return res.status(400).json({
          error: "Street, city, and country are required",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const existingCount = await tx.address.count({ where: { userId } });
        const isFirstAddress = existingCount === 0;
        const shouldBeDefault = addressData.isDefault || isFirstAddress;

        if (shouldBeDefault) {
          await tx.address.updateMany({
            where: { userId },
            data: { isDefault: false },
          });
        }

        const address = await tx.address.create({
          data: {
            userId,
            street: addressData.street,
            city: addressData.city,
            state: addressData.state,
            postalCode: addressData.postalCode,
            country: addressData.country,
            isDefault: shouldBeDefault,
          },
        });

        if (shouldBeDefault) {
          await tx.user.update({
            where: { id: userId },
            data: { defaultAddressId: address.id },
          });
        }

        return address;
      });

      res
        .status(201)
        .json({ message: "Address added successfully", data: result });
    } catch (error: any) {
      console.error("Add address error:", error);
      res.status(400).json({ error: error.message || "Failed to add address" });
    }
  }

  // Update address
  static async updateAddress(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { addressId } = req.params;
      const addressData: Partial<AddressInput> = req.body;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const existingAddress = await prisma.address.findFirst({
        where: { id: addressId, userId },
      });

      if (!existingAddress) {
        return res.status(404).json({ error: "Address not found" });
      }

      const result = await prisma.$transaction(async (tx) => {
        if (addressData.isDefault) {
          await tx.address.updateMany({
            where: { userId, NOT: { id: addressId } },
            data: { isDefault: false },
          });
        }

        const updateData: Record<string, any> = {};
        if (addressData.street !== undefined)
          updateData.street = addressData.street;
        if (addressData.city !== undefined) updateData.city = addressData.city;
        if (addressData.state !== undefined)
          updateData.state = addressData.state;
        if (addressData.postalCode !== undefined)
          updateData.postalCode = addressData.postalCode;
        if (addressData.country !== undefined)
          updateData.country = addressData.country;
        if (addressData.isDefault !== undefined)
          updateData.isDefault = addressData.isDefault;

        const address = await tx.address.update({
          where: { id: addressId },
          data: updateData,
        });

        if (addressData.isDefault === true) {
          await tx.user.update({
            where: { id: userId },
            data: { defaultAddressId: address.id },
          });
        } else if (
          existingAddress.isDefault &&
          addressData.isDefault === false
        ) {
          const anotherAddress = await tx.address.findFirst({
            where: { userId, NOT: { id: addressId } },
            orderBy: { createdAt: "asc" },
          });

          if (anotherAddress) {
            await tx.address.update({
              where: { id: anotherAddress.id },
              data: { isDefault: true },
            });
            await tx.user.update({
              where: { id: userId },
              data: { defaultAddressId: anotherAddress.id },
            });
          } else {
            await tx.user.update({
              where: { id: userId },
              data: { defaultAddressId: null },
            });
          }
        }

        return address;
      });

      res
        .status(200)
        .json({ message: "Address updated successfully", data: result });
    } catch (error: any) {
      console.error("Update address error:", error);
      res
        .status(400)
        .json({ error: error.message || "Failed to update address" });
    }
  }

  // Delete address
  static async deleteAddress(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { addressId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const address = await prisma.address.findFirst({
        where: { id: addressId, userId },
      });

      if (!address) {
        return res.status(404).json({ error: "Address not found" });
      }

      await prisma.$transaction(async (tx) => {
        const ordersUsingAddress = await tx.order.count({
          where: { shippingAddressId: addressId },
        });

        if (ordersUsingAddress > 0) {
          throw new Error("Cannot delete address that is used in orders");
        }

        // If this is the default address, we need to handle User.defaultAddressId first
        // to avoid foreign key constraint violation
        if (address.isDefault) {
          const anotherAddress = await tx.address.findFirst({
            where: { userId, NOT: { id: addressId } },
            orderBy: { createdAt: "asc" },
          });

          if (anotherAddress) {
            await tx.address.update({
              where: { id: anotherAddress.id },
              data: { isDefault: true },
            });
            await tx.user.update({
              where: { id: userId },
              data: { defaultAddressId: anotherAddress.id },
            });
          } else {
            await tx.user.update({
              where: { id: userId },
              data: { defaultAddressId: null },
            });
          }
        } else {
          // Double check User.defaultAddressId even if address.isDefault is false
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { defaultAddressId: true },
          });

          if (user?.defaultAddressId === addressId) {
            await tx.user.update({
              where: { id: userId },
              data: { defaultAddressId: null },
            });
          }
        }

        await tx.address.delete({ where: { id: addressId } });
      });

      res.status(200).json({ message: "Address deleted successfully" });
    } catch (error: any) {
      console.error("Delete address error:", error);
      const status = error.message?.includes("Cannot delete") ? 400 : 500;
      res
        .status(status)
        .json({ error: error.message || "Failed to delete address" });
    }
  }

  // Set default address
  static async setDefaultAddress(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { addressId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const address = await prisma.address.findFirst({
        where: { id: addressId, userId },
      });

      if (!address) {
        return res.status(404).json({ error: "Address not found" });
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.address.updateMany({
          where: { userId },
          data: { isDefault: false },
        });

        const updatedAddress = await tx.address.update({
          where: { id: addressId },
          data: { isDefault: true },
        });

        await tx.user.update({
          where: { id: userId },
          data: { defaultAddressId: addressId },
        });

        return updatedAddress;
      });

      res.status(200).json({
        message: "Default address set successfully",
        data: result,
      });
    } catch (error: any) {
      console.error("Set default address error:", error);
      res
        .status(400)
        .json({ error: error.message || "Failed to set default address" });
    }
  }

  // Get user's notifications
  static async getNotifications(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { unreadOnly, page = 1, limit = 20 } = req.query;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const where: Record<string, any> = { userId };
      if (unreadOnly === "true") {
        where.isRead = false;
      }

      const [notifications, total, unreadCount] = await prisma.$transaction([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { userId, isRead: false } }),
      ]);

      res.status(200).json({
        message: "Notifications fetched successfully",
        data: {
          notifications,
          unreadCount,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("Get notifications error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch notifications" });
    }
  }

  // Mark notification as read
  static async markNotificationRead(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { notificationId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const existing = await prisma.notification.findFirst({
        where: { id: notificationId, userId },
      });

      if (!existing) {
        return res.status(404).json({ error: "Notification not found" });
      }

      const notification = await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true },
      });

      res.status(200).json({
        message: "Notification marked as read",
        data: notification,
      });
    } catch (error: any) {
      console.error("Mark notification read error:", error);
      res.status(400).json({
        error: error.message || "Failed to mark notification as read",
      });
    }
  }

  // Mark all notifications as read
  static async markAllNotificationsRead(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const result = await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });

      res.status(200).json({
        message: "All notifications marked as read",
        data: { count: result.count },
      });
    } catch (error: any) {
      console.error("Mark all notifications read error:", error);
      res.status(400).json({
        error: error.message || "Failed to mark notifications as read",
      });
    }
  }

  // Logout user (blacklist token)
  static async logout(req: AuthRequest, res: Response) {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader && authHeader.split(" ")[1];

      if (token) {
        // Blacklist token for 24 hours
        await redisClient.setex(`blacklist:${token}`, 86400, "revoked");
      }

      res.status(200).json({ message: "Logged out successfully" });
    } catch (error: any) {
      console.error("Logout error:", error);
      res.status(500).json({ error: "Failed to logout" });
    }
  }
}
