import { Router } from "express";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeTSR } from "./tsr.middleware";
import { TsrController } from "./tsr.controller";

const router = Router();

router.get("/orders", authenticateToken, authorizeTSR, TsrController.getOrders);
router.get(
  "/orders/summary",
  authenticateToken,
  authorizeTSR,
  TsrController.getOrderSummary,
);
router.get("/orders/:orderId", authenticateToken, authorizeTSR, TsrController.getOrderById);
router.patch(
  "/orders/:orderId/status",
  authenticateToken,
  authorizeTSR,
  TsrController.updateOrderStatus,
);

export default router;
