// src/routes/order.routes.ts
import { Router } from "express";
import { OrderController } from "../controllers/order.controller";
import {
  authenticateToken,
  authorizeAdmin,
  authorizeApproved,
} from "../middleware/auth.middleware";
import { cacheRoute, invalidateCache } from "../middleware/cache.middleware";

const router = Router();

// ==================== USER ROUTES ====================
router.post(
  "/",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/orders*"),
  invalidateCache("cache:*:*sales*"),
  OrderController.createOrder,
);
router.get(
  "/my-orders",
  authenticateToken,
  authorizeApproved,
  cacheRoute(300),
  OrderController.getMyOrders,
);
router.get(
  "/my-orders/:orderId",
  authenticateToken,
  authorizeApproved,
  cacheRoute(3600),
  OrderController.getMyOrderById,
);
router.put(
  "/:orderId/cancel",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/orders*"),
  invalidateCache("cache:*:*sales*"),
  OrderController.cancelOrder,
);

// ==================== ADMIN ROUTES ====================
router.get(
  "/",
  authenticateToken,
  authorizeAdmin,
  cacheRoute(300),
  OrderController.getAllOrders,
);
router.get(
  "/:orderId",
  authenticateToken,
  authorizeAdmin,
  cacheRoute(3600),
  OrderController.getOrderById,
);
router.put(
  "/:orderId/status",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*orders*"),
  invalidateCache("cache:*:*sales*"),
  OrderController.updateOrderStatus,
);
router.put(
  "/:orderId/payment/confirm",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*sales*"),
  OrderController.confirmPaymentCOD,
);

export default router;
