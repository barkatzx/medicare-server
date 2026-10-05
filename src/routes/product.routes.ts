// src/routes/product.routes.ts
import { Router } from "express";
import { ProductController } from "../controllers/product.controller";
import {
  authenticateToken,
  authorizeAdmin,
} from "../middleware/auth.middleware";
import { uploadMultiple, handleMulterError } from "../middleware/upload.middleware";
import { cacheRoute, invalidateCache } from "../middleware/cache.middleware";
import { validateProductFields } from "../validators/product.validator";

const router = Router();

// ==================== PUBLIC ROUTES ====================
router.get("/", cacheRoute(300), ProductController.getAllProducts);
router.get("/trending", ProductController.getTrendingProducts);
router.get("/featured", ProductController.getFeaturedProducts);
router.get("/new", ProductController.getNewProducts);
router.get("/search", cacheRoute(60), ProductController.searchProducts); // Shorter cache for search
router.get("/:id", cacheRoute(300), ProductController.getProductById);

// ==================== PROTECTED ROUTES ====================
router.get(
  "/admin/low-stock",
  authenticateToken,
  authorizeAdmin,
  ProductController.getLowStockProducts,
);
router.get(
  "/admin/out-of-stock",
  authenticateToken,
  authorizeAdmin,
  ProductController.getOutOfStockProducts,
);

// ==================== ADMIN ROUTES ====================
router.post(
  "/",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*products*"),
  handleMulterError(uploadMultiple),
  validateProductFields,
  ProductController.createProductWithImages,
);

router.post(
  "/:id/images",
  authenticateToken,
  authorizeAdmin,
  handleMulterError(uploadMultiple),
  ProductController.addProductImages,
);

router.delete(
  "/:productId/images/:imageId",
  authenticateToken,
  authorizeAdmin,
  ProductController.deleteProductImage,
);

router.patch(
  "/:productId/images/:imageId/default",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*products*"),
  ProductController.setDefaultImage,
);


router.put(
  "/:id",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*products*"),
  handleMulterError(uploadMultiple),
  validateProductFields,
  ProductController.updateProduct,
);
router.delete(
  "/:id",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*products*"),
  ProductController.deleteProduct,
);
router.patch(
  "/:id/stock",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*products*"),
  ProductController.updateStock,
);

router.patch(
  "/:id/trending",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*products*"),
  ProductController.updateTrendingStatus,
);

router.patch(
  "/:id/featured",
  authenticateToken,
  authorizeAdmin,
  invalidateCache("cache:*:*products*"),
  ProductController.updateFeaturedStatus,
);

export default router;
