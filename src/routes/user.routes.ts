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

const router = Router();

// ==================== PUBLIC ROUTES ====================
// Limit to 5 registration attempts per 15 minutes
router.post("/register", rateLimit(5, 900), UserController.register);
// Limit to 10 login attempts per 5 minutes
router.post("/login", rateLimit(10, 300), UserController.login);
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

// ==================== ADDRESS ROUTES ====================
router.get(
  "/addresses",
  authenticateToken,
  authorizeApproved,
  cacheRoute(3600),
  UserController.getAddresses,
);
router.post(
  "/addresses",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/users/addresses*"),
  invalidateCache("cache:{userId}:/v1/users/profile*"),
  UserController.addAddress,
);
router.put(
  "/addresses/:addressId/default",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/users/addresses*"),
  invalidateCache("cache:{userId}:/v1/users/profile*"),
  UserController.setDefaultAddress,
); // must be before /:addressId
router.put(
  "/addresses/:addressId",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/users/addresses*"),
  invalidateCache("cache:{userId}:/v1/users/profile*"),
  UserController.updateAddress,
);
router.delete(
  "/addresses/:addressId",
  authenticateToken,
  authorizeApproved,
  invalidateCache("cache:{userId}:/v1/users/addresses*"),
  invalidateCache("cache:{userId}:/v1/users/profile*"),
  UserController.deleteAddress,
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
router.post(
  "/notifications/send",
  authenticateToken,
  authorizeAdmin,
  UserController.sendNotification,
);
router.post(
  "/notifications/send-bulk",
  authenticateToken,
  authorizeAdmin,
  UserController.sendBulkNotifications,
);

// ==================== NOTIFICATION ROUTES ====================
router.get(
  "/notifications",
  authenticateToken,
  authorizeApproved,
  UserController.getNotifications,
);
router.put(
  "/notifications/read-all",
  authenticateToken,
  authorizeApproved,
  UserController.markAllNotificationsRead,
);
router.put(
  "/notifications/:notificationId",
  authenticateToken,
  authorizeApproved,
  UserController.markNotificationRead,
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
