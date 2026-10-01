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
router.get("/summary", cacheRoute(3600), SalesController.getSalesSummary);

// Custom date range sales
router.get("/custom-range", cacheRoute(300), SalesController.getCustomRangeSales);

// Top selling products
router.get("/top-products", cacheRoute(3600), SalesController.getTopProducts);

// Export sales report
router.get("/export", SalesController.exportSalesReport);

// See Dashboard Statistics
router.get("/dashboard", cacheRoute(300), SalesController.getDashboardStats);

// Today's ordered products summary
router.get("/today-ordered-products", cacheRoute(300), SalesController.getTodayOrderedProducts);

export default router;
