import { Router } from "express";
import {
  authenticateToken,
  authorizeAdmin,
} from "../middleware/auth.middleware";
import { handleMulterError, upload } from "../middleware/upload.middleware";
import { NotificationController } from "./notifications.controller";

const router = Router();
const photoUpload = handleMulterError(upload.single("photo"));

router.use(authenticateToken);

router.post("/device-token", NotificationController.registerDeviceToken);
router.delete("/device-token", NotificationController.unregisterDeviceToken);

// ==================== ADMIN ROUTES ====================
router.post(
  "/user/:userId",
  authorizeAdmin,
  photoUpload,
  NotificationController.sendToUser,
);
router.post("/all", authorizeAdmin, photoUpload, NotificationController.sendToAll);

// ==================== CUSTOMER ROUTES ====================
// Static paths must be declared before "/:id"
router.post("/markall", NotificationController.markAllRead);
router.delete("/alldelete", NotificationController.deleteAll);
router.get("/", NotificationController.getMyNotifications);
router.get("/:id", NotificationController.getNotificationById);

export default router;
