import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import adminTsrSalesRoutes from "./admin-tsr-sales/admin-tsr-sales.routes";
import redisClient, { connectRedis } from "./config/redis";
import { prisma } from "./config/supabase";
import categoryRoutes from "./routes/category.routes";
import orderRoutes from "./routes/order.routes";
import productRoutes from "./routes/product.routes";
import salesRoutes from "./routes/sales.routes"; // Import sales routes
import userRoutes from "./routes/user.routes";
import tsrRoutes from "./tsr/tsr.routes";
// import { cacheMiddleware } from "./middleware/cache.middleware"; // Removed global cache

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to Redis
connectRedis();

// Global Cache Middleware - Removed to allow route-specific caching

// Routes
app.use("/v1/users", userRoutes);
app.use("/v1/categories", categoryRoutes);
app.use("/v1/products", productRoutes);
app.use("/v1/orders", orderRoutes);
app.use("/v1/tsr", tsrRoutes);
app.use("/v1/tsr", tsrRoutes);
app.use("/admin/tsr-sales", adminTsrSalesRoutes);
app.use("/v1/admin/tsr-sales", adminTsrSalesRoutes);
app.use("/v1/sales", salesRoutes);

// Health check
app.get("/", (req, res) => {
  res.status(200).json({ status: "OK", message: "Server is running" });
});

// Error handling middleware
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error(err.stack);
    res.status(500).json({ error: "Something went wrong!" });
  },
);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  console.log("Disconnected from database");
  await redisClient.quit();
  console.log("Disconnected from Redis");

  process.exit(0);
});
