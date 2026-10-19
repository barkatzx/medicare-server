import { Router } from "express";
import { authenticateToken } from "../middleware/auth.middleware";
import { cacheRoute } from "../middleware/cache.middleware";
import { authorizeTSR } from "./tsr.middleware";
import { TsrController } from "./tsr.controller";

const router = Router();

router.get(
  "/orders",
  authenticateToken,
  authorizeTSR,
  cacheRoute(30, "tsr-orders-v1", ["orders", "tsr-sales"]),
  TsrController.getOrders,
);
router.get(
  "/orders/summary",
  authenticateToken,
  authorizeTSR,
  cacheRoute(30, "tsr-summary-v1", ["orders", "tsr-sales"]),
  TsrController.getOrderSummary,
);
router.get(
  "/orders/:orderId",
  authenticateToken,
  authorizeTSR,
  cacheRoute(30, "tsr-order-v1", ["orders"]),
  TsrController.getOrderById,
);
router.patch(
  "/orders/:orderId/status",
  authenticateToken,
  authorizeTSR,
  TsrController.updateOrderStatus,
);

export default router;
