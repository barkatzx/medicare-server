import { Router } from "express";
import {
  authenticateToken,
  authorizeAdmin,
} from "../middleware/auth.middleware";
import { AdminTsrSalesController } from "./admin-tsr-sales.controller";

const router = Router();

router.use(authenticateToken, authorizeAdmin);
router.get("/summary", AdminTsrSalesController.getSummary);
router.get("/tsrs", AdminTsrSalesController.getTsrs);
router.get("/tsrs/:tsrId/orders", AdminTsrSalesController.getTsrOrders);
router.get("/tsrs/:tsrId", AdminTsrSalesController.getTsrDetail);

export default router;
