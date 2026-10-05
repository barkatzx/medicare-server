import { Router } from "express";
import { CategoryController } from "../controllers/category.controller";
import {
  authenticateToken,
  authorizeAdmin,
} from "../middleware/auth.middleware";

const router = Router();

router.get(
  "/dristributors",
  authenticateToken,
  authorizeAdmin,
  CategoryController.getAllDistributor,
);
router.post(
  "/dristributors",
  authenticateToken,
  authorizeAdmin,
  CategoryController.createDistributor,
);
router.get(
  "/dristributors/:id/products",
  authenticateToken,
  authorizeAdmin,
  CategoryController.getDristributorProducts,
);
router.get(
  "/dristributors/:id",
  authenticateToken,
  authorizeAdmin,
  CategoryController.getDristributorById,
);
router.patch(
  "/dristributors/:id",
  authenticateToken,
  authorizeAdmin,
  CategoryController.updateDistributor,
);
router.delete(
  "/dristributors/:id",
  authenticateToken,
  authorizeAdmin,
  CategoryController.deleteDistributor,
);

export default router;
