import { NotificationType } from "@prisma/client";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TITLE_MAX = 150;
export const MESSAGE_MAX = 2000;
export const ALLOWED_PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"];
export const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
export const DEVICE_TOKEN_MAX = 4096;
export const DEVICE_PLATFORMS = ["android", "ios", "web"] as const;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_REGEX.test(value);

export function validateDeviceTokenBody(body: any) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const platform = typeof body?.platform === "string" ? body.platform : "";
  if (token.length < 20 || token.length > DEVICE_TOKEN_MAX || /\s/.test(token)) {
    return { error: "token must be a valid FCM registration token" };
  }
  if (!(DEVICE_PLATFORMS as readonly string[]).includes(platform)) {
    return { error: `platform must be one of: ${DEVICE_PLATFORMS.join(", ")}` };
  }
  return { data: { token, platform: platform as (typeof DEVICE_PLATFORMS)[number] } };
}

export function validateDeviceTokenDeleteBody(body: any) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (token.length < 20 || token.length > DEVICE_TOKEN_MAX || /\s/.test(token)) {
    return { error: "token must be a valid FCM registration token" };
  }
  return { data: { token } };
}

export function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const rawLimit = parseInt(String(query.limit ?? "20"), 10) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit));
  return { page, limit };
}

export function validateSendBody(
  body: any,
  file?: Express.Multer.File,
): { error?: string; data?: { title: string; message: string; type: NotificationType } } {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const type = body?.type;

  if (!title || title.length > TITLE_MAX) {
    return { error: `title is required (max ${TITLE_MAX} characters)` };
  }
  if (!message || message.length > MESSAGE_MAX) {
    return { error: `message is required (max ${MESSAGE_MAX} characters)` };
  }
  if (!Object.values(NotificationType).includes(type)) {
    return {
      error: `type must be one of: ${Object.values(NotificationType).join(", ")}`,
    };
  }
  if (file) {
    if (!ALLOWED_PHOTO_MIME.includes(file.mimetype)) {
      return { error: "photo must be a JPEG, PNG or WebP image" };
    }
    if (file.size > MAX_PHOTO_SIZE) {
      return { error: "photo must not exceed 5MB" };
    }
  }
  return { data: { title, message, type } };
}
