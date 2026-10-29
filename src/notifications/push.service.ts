import { firebaseMessaging } from "../config/firebase";
import { prisma } from "../config/supabase";

const MULTICAST_LIMIT = 500;

export type PushPayload = {
  title: string;
  message: string;
  notificationId: string;
  type: string;
  photo: string | null;
};

export type PushOutcome = {
  configured: boolean;
  tokens: number;
  accepted: number;
  failed: number;
  skipped: number;
  removedInvalidTokens: number;
};

export const isFirebaseConfigured = () =>
  Boolean(
    process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.K_SERVICE ||
      process.env.GAE_ENV,
  );

export class PushService {
  static async deliver(userId: string, payload: PushPayload): Promise<PushOutcome> {
    const tokens = await prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });
    return this.deliverTokens(tokens.map(({ token }) => token), payload);
  }

  static async deliverTokens(
    tokens: string[],
    payload: PushPayload,
  ): Promise<PushOutcome> {
    const outcome: PushOutcome = {
      configured: isFirebaseConfigured(),
      tokens: tokens.length,
      accepted: 0,
      failed: 0,
      skipped: 0,
      removedInvalidTokens: 0,
    };
    if (!tokens.length) return outcome;
    if (!outcome.configured) {
      outcome.skipped = tokens.length;
      return outcome;
    }

    const invalidTokens: string[] = [];
    for (let i = 0; i < tokens.length; i += MULTICAST_LIMIT) {
      const batch = tokens.slice(i, i + MULTICAST_LIMIT);
      try {
        const response = await firebaseMessaging.sendEachForMulticast({
          tokens: batch,
          notification: { title: payload.title, body: payload.message },
          data: {
            notificationId: payload.notificationId,
            type: payload.type,
            ...(payload.photo ? { photo: payload.photo } : {}),
          },
        });
        outcome.accepted += response.successCount;
        outcome.failed += response.failureCount;
        response.responses.forEach((result, index) => {
          const code = result.error?.code;
          if (
            !result.success &&
            (code === "messaging/registration-token-not-registered" ||
              code === "messaging/invalid-registration-token")
          ) {
            invalidTokens.push(batch[index]);
          }
        });
      } catch (error) {
        outcome.failed += batch.length;
        const code = (error as { code?: string })?.code ?? "unknown";
        console.error("FCM batch delivery failed", { code, count: batch.length });
      }
    }

    if (invalidTokens.length) {
      try {
        const result = await prisma.deviceToken.deleteMany({
          where: { token: { in: invalidTokens } },
        });
        outcome.removedInvalidTokens = result.count;
      } catch (error) {
        console.error("Invalid FCM token cleanup failed", {
          code: (error as { code?: string })?.code ?? "unknown",
          count: invalidTokens.length,
        });
      }
    }
    return outcome;
  }
}
