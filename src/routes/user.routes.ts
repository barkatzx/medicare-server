import { Router } from "express";
import { CartController } from "../controllers/cart.controller";
import { UserController } from "../controllers/user.controller";
import {
  authenticateToken,
  authorizeAdmin,
  authorizeApproved,
} from "../middleware/auth.middleware";
import { cacheRoute, invalidateCache } from "../middleware/cache.middleware";
import { rateLimit } from "../middleware/rate-limit.middleware";
import { validateLogin, validateRegister } from "../validators/auth.validator";

const router = Router();

// ==================== PUBLIC ROUTES ====================
// Limit to 5 registration attempts per 15 minutes
router.post(
  "/register",
  rateLimit(5, 900),
  validateRegister,
  UserController.register,
);
// Limit to 10 login attempts per 5 minutes
router.post("/login", rateLimit(10, 300), validateLogin, UserController.login);
router.post("/logout", authenticateToken, UserController.logout);

// ==================== USER PROFILE ROUTES ====================
router.get(
  "/profile",
  authenticateToken,
  authorizeApproved,
  cacheRoute(3600), // Cache profile for 1 hour
  UserController.getProfile,
);
router.put(
  "/profile",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/users/profile*"),
  UserController.updateProfile,
);

router.post(
  "/change-password",
  authenticateToken,
  authorizeApproved,
  UserController.changePassword,
);


// ==================== ADMIN ROUTES ====================
router.get(
  "/all",
  authenticateToken,
  authorizeAdmin,
  UserController.getAllUsers,
);
router.put(
  "/approve/:userId",
  authenticateToken,
  authorizeAdmin,
  UserController.approveUser,
);
router.patch(
  "/:userId/role",
  authenticateToken,
  authorizeAdmin,
  UserController.promoteUserToTSR,
);
router.delete(
  "/:userId",
  authenticateToken,
  authorizeAdmin,
  UserController.deleteProfile,
);

// ==================== CART ROUTES ====================
// Cart data is now cached using internal Redis for sub-millisecond response times.
router.get(
  "/cart",
  authenticateToken,
  authorizeApproved,
  cacheRoute(3600), // Cache for 1 hour
  CartController.getCart,
);
router.get(
  "/cart/count",
  authenticateToken,
  authorizeApproved,
  cacheRoute(3600),
  CartController.getCartItemCount,
);
router.post(
  "/cart/add",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/users/cart*"),
  CartController.addToCart,
);
router.put(
  "/cart/item/:itemId",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/users/cart*"),
  CartController.updateCartItem,
);
router.delete(
  "/cart/item/:itemId",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/users/cart*"),
  CartController.removeFromCart,
);
router.delete(
  "/cart/clear",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/users/cart*"),
  CartController.clearCart,
);

export default router;
