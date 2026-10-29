import { createClient } from "@supabase/supabase-js";
import { NotificationType, Role } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "../config/supabase";

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
    try {
      const notification = await prisma.notification.create({
        data: { userId, ...input, photo },
        select: publicFields,
      });
      return { status: "ok" as const, notification };
    } catch (error) {
      if (photo) await this.deletePhoto(photo);
      throw error;
    }
  }

  static async sendToAll(input: SendInput, file?: Express.Multer.File) {
    const customers = await prisma.user.findMany({
      where: { role: Role.customer, isApproved: true },
      select: { id: true },
    });
    if (customers.length === 0) return { recipients: 0, photo: null };

    const photo = file ? await this.uploadPhoto(file) : null;
    let created = 0;
    try {
      for (let i = 0; i < customers.length; i += INSERT_BATCH_SIZE) {
        const batch = customers.slice(i, i + INSERT_BATCH_SIZE);
        const result = await prisma.notification.createMany({
          data: batch.map((c) => ({ userId: c.id, ...input, photo })),
        });
        created += result.count;
      }
    } catch (error) {
      if (created === 0) {
        if (photo) await this.deletePhoto(photo);
        throw error;
      }
      // Keep photo and already-saved notifications on partial failure
      console.error("Partial notification broadcast failure:", error);
    }
    return { recipients: created, photo };
  }
}
