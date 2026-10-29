import { Response } from "express";
import { AuthRequest } from "../types";
import { NotificationService } from "./notifications.service";
import {
  isUuid,
  parsePagination,
  validateSendBody,
  validateDeviceTokenBody,
  validateDeviceTokenDeleteBody,
} from "./notifications.validation";

export class NotificationController {
  static async registerDeviceToken(req: AuthRequest, res: Response) {
    const { error, data } = validateDeviceTokenBody(req.body);
    if (error || !data) return res.status(400).json({ error });
    try {
      const deviceToken = await NotificationService.registerDeviceToken(
        req.user!.id,
        data.token,
        data.platform,
      );
      return res.json({ success: true, data: { id: deviceToken.id } });
    } catch (err) {
      console.error("Device token registration failed", {
        code: (err as { code?: string })?.code ?? "unknown",
      });
      return res.status(500).json({ error: "Failed to register device token" });
    }
  }

  static async unregisterDeviceToken(req: AuthRequest, res: Response) {
    const { error, data } = validateDeviceTokenDeleteBody(req.body);
    if (error || !data) return res.status(400).json({ error });
    try {
      const deleted = await NotificationService.unregisterDeviceToken(
        req.user!.id,
        data.token,
      );
      return res.json({ success: true, data: { removed: deleted > 0 } });
    } catch (err) {
      console.error("Device token removal failed", {
        code: (err as { code?: string })?.code ?? "unknown",
      });
      return res.status(500).json({ error: "Failed to unregister device token" });
    }
  }

  static async getMyNotifications(req: AuthRequest, res: Response) {
    try {
      const { page, limit } = parsePagination(req.query);
      const { items, pagination } = await NotificationService.list(
        req.user!.id,
        page,
        limit,
      );
      res.json({ success: true, data: items, pagination });
    } catch (error) {
      console.error("Get notifications error:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  }

  static async getNotificationById(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!isUuid(id)) {
        return res.status(404).json({ error: "Notification not found" });
      }
      const notification = await NotificationService.openOne(req.user!.id, id);
      if (!notification) {
        return res.status(404).json({ error: "Notification not found" });
      }
      res.json({ success: true, data: notification });
    } catch (error) {
      console.error("Get notification error:", error);
      res.status(500).json({ error: "Failed to fetch notification" });
    }
  }

  static async markAllRead(req: AuthRequest, res: Response) {
    try {
      const updated = await NotificationService.markAllRead(req.user!.id);
      res.json({
        success: true,
        message: "All notifications marked as read",
        data: { updatedCount: updated },
      });
    } catch (error) {
      console.error("Mark all read error:", error);
      res.status(500).json({ error: "Failed to mark notifications as read" });
    }
  }

  static async deleteAll(req: AuthRequest, res: Response) {
    try {
      const deleted = await NotificationService.deleteAll(req.user!.id);
      res.json({
        success: true,
        message: "All notifications deleted",
        data: { deletedCount: deleted },
      });
    } catch (error) {
      console.error("Delete all notifications error:", error);
      res.status(500).json({ error: "Failed to delete notifications" });
    }
  }

  static async sendToUser(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      if (!isUuid(userId)) {
        return res.status(400).json({ error: "Invalid user id" });
      }
      const { error, data } = validateSendBody(req.body, req.file);
      if (error || !data) return res.status(400).json({ error });

      const result = await NotificationService.sendToUser(userId, data, req.file);
      if (result.status === "not_found") {
        return res.status(404).json({ error: "User not found" });
      }
      if (result.status === "ineligible") {
        return res
          .status(400)
          .json({ error: "User is not an eligible customer" });
      }
      res.status(201).json({
        success: true,
        message: "Notification saved",
        data: {
          savedCount: 1,
          recipients: 1,
          notification: result.notification,
          push: result.push,
        },
      });
    } catch (error) {
      console.error("Send notification error:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  }

  static async sendToAll(req: AuthRequest, res: Response) {
    try {
      const { error, data } = validateSendBody(req.body, req.file);
      if (error || !data) return res.status(400).json({ error });

      const result = await NotificationService.sendToAll(data, req.file);
      res.status(201).json({
        success: true,
        message: "Notifications saved",
        data: {
          recipients: result.recipients,
          savedCount: result.recipients,
          push: result.push,
          notification: { ...data, photo: result.photo },
        },
      });
    } catch (error) {
      console.error("Broadcast notification error:", error);
      res.status(500).json({ error: "Failed to send notifications" });
    }
  }
}
