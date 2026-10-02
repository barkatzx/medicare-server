// src/routes/sales.routes.ts
import { Router } from "express";
import { SalesController } from "../controllers/sales.controller";
import {
  authenticateToken,
  authorizeAdmin,
} from "../middleware/auth.middleware";
import { cacheRoute } from "../middleware/cache.middleware";

const router = Router();

// All sales routes require admin authentication
router.use(authenticateToken, authorizeAdmin);

// Daily sales report
router.get("/daily", SalesController.getDailySales);

// Weekly sales report
router.get("/weekly", SalesController.getWeeklySales);

// Monthly sales report
router.get("/monthly", SalesController.getMonthlySales);

// Yearly sales report
router.get("/yearly", SalesController.getYearlySales);

// Sales summary (overall statistics)
router.get(
  "/summary",
  cacheRoute(300, "sales-summary-v3"),
  SalesController.getSalesSummary,
);

// Today's ordered products summary
router.get("/today-ordered-products", cacheRoute(300), SalesController.getTodayOrderedProducts);

export default router;
