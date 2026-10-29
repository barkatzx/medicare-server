import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

// Firebase Admin uses ADC by default (including GOOGLE_APPLICATION_CREDENTIALS).
// FIREBASE_PROJECT_ID is optional and can explicitly select the Firebase project.
const app =
  getApps()[0] ??
  initializeApp({
    credential: applicationDefault(),
    ...(process.env.FIREBASE_PROJECT_ID
      ? { projectId: process.env.FIREBASE_PROJECT_ID }
      : {}),
  });

export const firebaseMessaging = getMessaging(app);
