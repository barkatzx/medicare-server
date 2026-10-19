import { Router } from "express";
import {
  authenticateToken,
  authorizeAdmin,
} from "../middleware/auth.middleware";
import { cacheRoute } from "../middleware/cache.middleware";
import { AdminTsrSalesController } from "./admin-tsr-sales.controller";

const router = Router();

router.use(authenticateToken, authorizeAdmin);
router.get(
  "/allsummary",
  cacheRoute(30, "admin-tsr-allsummary-v1", ["orders", "admin-tsr-sales"]),
  AdminTsrSalesController.getAllSummary,
);
router.get(
  "/best-performance",
  cacheRoute(30, "admin-tsr-best-performance-v1", [
    "orders",
    "admin-tsr-sales",
  ]),
  AdminTsrSalesController.getBestPerformance,
);
router.get(
  "/summary",
  cacheRoute(30, "admin-tsr-summary-v1", ["orders", "admin-tsr-sales"]),
  AdminTsrSalesController.getSummary,
);
router.get(
  "/tsrs",
  cacheRoute(30, "admin-tsr-list-v1", ["orders", "admin-tsr-sales"]),
  AdminTsrSalesController.getTsrs,
);
router.get(
  "/tsrs/:tsrId/orders",
  cacheRoute(30, "admin-tsr-orders-v1", ["orders", "admin-tsr-sales"]),
  AdminTsrSalesController.getTsrOrders,
);
router.get(
  "/tsrs/:tsrId",
  cacheRoute(30, "admin-tsr-detail-v1", ["orders", "admin-tsr-sales"]),
  AdminTsrSalesController.getTsrDetail,
);

export default router;
