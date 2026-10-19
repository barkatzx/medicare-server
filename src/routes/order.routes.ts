// src/routes/order.routes.ts
import { Router } from "express";
import { OrderController } from "../controllers/order.controller";
import {
  authenticateToken,
  authorizeAdmin,
  authorizeApproved,
} from "../middleware/auth.middleware";
import { cacheRoute } from "../middleware/cache.middleware";

const router = Router();

// ==================== USER ROUTES ====================
router.post(
  "/",
  authenticateToken,
  authorizeApproved,
  OrderController.createOrder,
);
router.get(
  "/my-orders",
  authenticateToken,
  authorizeApproved,
  cacheRoute(60, "orders-v1", ["orders"]),
  OrderController.getMyOrders,
);
router.get(
  "/my-orders/:orderId",
  authenticateToken,
  authorizeApproved,
  cacheRoute(60, "orders-v1", ["orders"]),
  OrderController.getMyOrderById,
);
router.put(
  "/:orderId/cancel",
  authenticateToken,
  authorizeApproved,
  OrderController.cancelOrder,
);

// ==================== ADMIN ROUTES ====================
router.get(
  "/",
  authenticateToken,
  authorizeAdmin,
  cacheRoute(60, "orders-v1", ["orders"]),
  OrderController.getAllOrders,
);
router.get(
  "/:orderId",
  authenticateToken,
  authorizeAdmin,
  cacheRoute(60, "orders-v1", ["orders"]),
  OrderController.getOrderById,
);
router.put(
  "/:orderId/status",
  authenticateToken,
  authorizeAdmin,
  OrderController.updateOrderStatus,
);
router.put(
  "/:orderId/payment/confirm",
  authenticateToken,
  authorizeAdmin,
  OrderController.confirmPaymentCOD,
);

export default router;
