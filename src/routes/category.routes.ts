// src/routes/category.routes.ts
import { Router } from "express";
import { CategoryController } from "../controllers/category.controller";
import {
  authenticateToken,
  authorizeAdmin,
  authorizeApproved,
} from "../middleware/auth.middleware";
import { cacheRoute, invalidateCache } from "../middleware/cache.middleware";

const router = Router();

// ==================== PUBLIC ROUTES ====================
router.get("/", cacheRoute(600, undefined, ["products"]), CategoryController.getAllCategories);
router.get("/:id", cacheRoute(600, undefined, ["products"]), CategoryController.getCategoryById);
router.get("/:id/products", cacheRoute(300, undefined, ["products"]), CategoryController.getCategoryProducts);

// ==================== ADMIN ROUTES ====================
router.post(
  "/",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*categories*"),
  CategoryController.createCategory,
);
router.put(
  "/:id",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*categories*"),
  CategoryController.updateCategory,
);
router.delete(
  "/:id",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*categories*"),
  CategoryController.deleteCategory,
);

export default router;
