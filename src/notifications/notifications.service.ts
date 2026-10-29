import { createClient } from "@supabase/supabase-js";
import { NotificationType, Role } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "../config/supabase";
import { isFirebaseConfigured, PushOutcome, PushService } from "./push.service";

const BUCKET = process.env.NOTIFICATION_PHOTOS_BUCKET || "notification-photos";
const INSERT_BATCH_SIZE = 1000;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const publicFields = {
  id: true,
  title: true,
  message: true,
  type: true,
  photo: true,
  isRead: true,
  createdAt: true,
} as const;

type SendInput = { title: string; message: string; type: NotificationType };

export class NotificationService {
  static async registerDeviceToken(
    userId: string,
    token: string,
    platform: "android" | "ios" | "web",
  ) {
    return prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform, isActive: true },
      update: { userId, platform, isActive: true },
      select: { id: true },
    });
  }

  static async unregisterDeviceToken(userId: string, token: string) {
    const result = await prisma.deviceToken.deleteMany({ where: { userId, token } });
    return result.count;
  }

  // ---------- Storage ----------
  static async uploadPhoto(file: Express.Multer.File): Promise<string> {
    const ext = MIME_EXT[file.mimetype] || "jpg";
    const filePath = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: "3600",
        upsert: false,
      });
    if (error) {
      console.error("Notification photo upload error:", error);
      throw new Error("Failed to upload notification photo");
    }
    return supabase.storage.from(BUCKET).getPublicUrl(filePath).data.publicUrl;
  }

  static async deletePhoto(url: string): Promise<void> {
    try {
      const marker = `/${BUCKET}/`;
      const idx = url.indexOf(marker);
      if (idx === -1) return;
      await supabase.storage.from(BUCKET).remove([url.slice(idx + marker.length)]);
    } catch (error) {
      console.error("Notification photo cleanup error:", error);
    }
  }

  // ---------- Customer ----------
  static async list(userId: string, page: number, limit: number) {
    const [total, items] = await Promise.all([
      prisma.notification.count({ where: { userId } }),
      prisma.notification.findMany({
        where: { userId },
        select: publicFields,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }

  // Returns null when not found / not owned; marks as read.
  static async openOne(userId: string, id: string) {
    const existing = await prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return null;
    return prisma.notification.update({
      where: { id },
      data: { isRead: true },
      select: publicFields,
    });
  }

  static async markAllRead(userId: string) {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return result.count;
  }

  static async deleteAll(userId: string) {
    const result = await prisma.notification.deleteMany({ where: { userId } });
    return result.count;
  }

  // ---------- Admin ----------
  static async sendToUser(
    userId: string,
    input: SendInput,
    file?: Express.Multer.File,
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isApproved: true },
    });
    if (!user) return { status: "not_found" as const };
    if (user.role !== Role.customer || !user.isApproved) {
      return { status: "ineligible" as const };
    }

    const photo = file ? await this.uploadPhoto(file) : null;
    let notification;
    try {
      notification = await prisma.notification.create({
        data: { userId, ...input, photo },
        select: publicFields,
      });
    } catch (error) {
      if (photo) await this.deletePhoto(photo);
      throw error;
    }
    const push = await safelyDeliver(async () =>
      PushService.deliver(userId, {
        title: notification.title,
        message: notification.message,
        notificationId: notification.id,
        type: notification.type,
        photo: notification.photo,
      }),
    );
    return { status: "ok" as const, notification, push };
  }

  static async sendToAll(input: SendInput, file?: Express.Multer.File) {
    const customers = await prisma.user.findMany({
      where: { role: Role.customer, isApproved: true },
      select: { id: true },
    });
    if (customers.length === 0)
      return { recipients: 0, photo: null, push: emptyPushOutcome() };

    const photo = file ? await this.uploadPhoto(file) : null;
    let created = 0;
    const savedNotifications: Array<{
      id: string;
      userId: string;
      title: string;
      message: string;
      type: NotificationType;
      photo: string | null;
    }> = [];
    try {
      for (let i = 0; i < customers.length; i += INSERT_BATCH_SIZE) {
        const batch = customers.slice(i, i + INSERT_BATCH_SIZE);
        const result = await prisma.notification.createManyAndReturn({
          data: batch.map((c) => ({ userId: c.id, ...input, photo })),
          select: { id: true, userId: true, title: true, message: true, type: true, photo: true },
        });
        created += result.length;
        savedNotifications.push(...result);
      }
    } catch (error) {
      if (created === 0) {
        if (photo) await this.deletePhoto(photo);
        throw error;
      }
      // Keep photo and already-saved notifications on partial failure
      console.error("Partial notification broadcast failure:", error);
    }
    const userIds = [...new Set(savedNotifications.map(({ userId }) => userId))];
    let registered: Array<{ userId: string; token: string }> = [];
    let lookupFailed = false;
    try {
      registered = userIds.length
        ? await prisma.deviceToken.findMany({
            where: { userId: { in: userIds }, isActive: true },
            select: { userId: true, token: true },
          })
        : [];
    } catch (error) {
      lookupFailed = true;
      console.error("FCM token lookup failed", {
        code: (error as { code?: string })?.code ?? "unknown",
      });
    }
    const tokensByUser = new Map<string, string[]>();
    for (const row of registered) {
      const list = tokensByUser.get(row.userId) ?? [];
      list.push(row.token);
      tokensByUser.set(row.userId, list);
    }
    const push = emptyPushOutcome();
    const deliveries: PushOutcome[] = [];
    if (!lookupFailed) {
      for (const notification of savedNotifications) {
        deliveries.push(await safelyDeliver(() => PushService.deliverTokens(
          tokensByUser.get(notification.userId) ?? [],
          {
          title: notification.title,
          message: notification.message,
          notificationId: notification.id,
          type: notification.type,
          photo: notification.photo,
          },
        )));
      }
    }
    if (lookupFailed) push.skipped = created;
    for (const outcome of deliveries) {
      push.configured = push.configured || outcome.configured;
      push.tokens += outcome.tokens;
      push.accepted += outcome.accepted;
      push.failed += outcome.failed;
      push.skipped += outcome.skipped;
      push.removedInvalidTokens += outcome.removedInvalidTokens;
    }
    return { recipients: created, photo, push };
  }
}

function emptyPushOutcome(): PushOutcome {
  return { configured: isFirebaseConfigured(), tokens: 0, accepted: 0, failed: 0, skipped: 0, removedInvalidTokens: 0 };
}

async function safelyDeliver(operation: () => Promise<PushOutcome>): Promise<PushOutcome> {
  try {
    return await operation();
  } catch (error) {
    console.error("FCM delivery preparation failed", {
      code: (error as { code?: string })?.code ?? "unknown",
    });
    return { ...emptyPushOutcome(), configured: true, failed: 1 };
  }
}
