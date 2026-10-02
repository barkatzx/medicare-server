// src/controllers/sales.controller.ts
import { Response } from "express";
import { prisma } from "../config/supabase";
import { SalesService } from "../services/sales.service";
import { AuthRequest } from "../types";

export class SalesController {
  /**
   * Get daily sales report
   */
  static async getDailySales(req: AuthRequest, res: Response) {
    try {
      const salesData = await SalesService.getDailySales();

      res.status(200).json({
        success: true,
        data: salesData,
        message: "Daily sales retrieved successfully",
      });
    } catch (error) {
      console.error("Get daily sales error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch daily sales",
      });
    }
  }

  /**
   * Get weekly sales report (last 7 days)
   */
  static async getWeeklySales(req: AuthRequest, res: Response) {
    try {
      const weeklyData = await SalesService.getWeeklySales();

      // Calculate weekly totals
      const weeklyTotals = weeklyData.reduce(
        (acc, day) => ({
          totalSales: acc.totalSales + day.totalSales,
          totalOrders: acc.totalOrders + day.totalOrders,
          totalItemsSold: acc.totalItemsSold + day.totalItemsSold,
        }),
        { totalSales: 0, totalOrders: 0, totalItemsSold: 0 },
      );
      const weeklySummary = {
        ...weeklyTotals,
        averageOrderValue:
          weeklyTotals.totalOrders > 0
            ? weeklyTotals.totalSales / weeklyTotals.totalOrders
            : 0,
      };

      res.status(200).json({
        success: true,
        data: {
          daily_breakdown: weeklyData,
          weekly_totals: weeklySummary,
          average_daily_sales: weeklyTotals.totalSales / 7,
        },
        message: "Weekly sales retrieved successfully",
      });
    } catch (error) {
      console.error("Get weekly sales error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch weekly sales",
      });
    }
  }

  /**
   * Get monthly sales report (last 30 days)
   */
  static async getMonthlySales(req: AuthRequest, res: Response) {
    try {
      const monthlyData = await SalesService.getMonthlySales();

      // Calculate monthly totals
      const monthlyTotals = monthlyData.reduce(
        (acc, day) => ({
          totalSales: acc.totalSales + day.totalSales,
          totalOrders: acc.totalOrders + day.totalOrders,
          totalItemsSold: acc.totalItemsSold + day.totalItemsSold,
        }),
        { totalSales: 0, totalOrders: 0, totalItemsSold: 0 },
      );
      const monthlySummary = {
        ...monthlyTotals,
        averageOrderValue:
          monthlyTotals.totalOrders > 0
            ? monthlyTotals.totalSales / monthlyTotals.totalOrders
            : 0,
      };

      res.status(200).json({
        success: true,
        data: {
          daily_breakdown: monthlyData,
          monthly_totals: monthlySummary,
          average_daily_sales: monthlyTotals.totalSales / 30,
          best_day: monthlyData.reduce(
            (best, day) => (day.totalSales > best.totalSales ? day : best),
            monthlyData[0],
          ),
        },
        message: "Monthly sales retrieved successfully",
      });
    } catch (error) {
      console.error("Get monthly sales error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch monthly sales",
      });
    }
  }

  /**
   * Get yearly sales report (last 12 months)
   */
  static async getYearlySales(req: AuthRequest, res: Response) {
    try {
      const yearlyData = await SalesService.getYearlySales();

      // Calculate yearly totals
      const yearlyTotals = yearlyData.reduce(
        (acc, month) => ({
          totalSales: acc.totalSales + month.totalSales,
          totalOrders: acc.totalOrders + month.totalOrders,
          totalItemsSold: acc.totalItemsSold + month.totalItemsSold,
        }),
        { totalSales: 0, totalOrders: 0, totalItemsSold: 0 },
      );
      const yearlySummary = {
        ...yearlyTotals,
        averageOrderValue:
          yearlyTotals.totalOrders > 0
            ? yearlyTotals.totalSales / yearlyTotals.totalOrders
            : 0,
      };

      res.status(200).json({
        success: true,
        data: {
          monthly_breakdown: yearlyData,
          yearly_totals: yearlySummary,
          average_monthly_sales: yearlyTotals.totalSales / 12,
          best_month: yearlyData.reduce(
            (best, month) =>
              month.totalSales > best.totalSales ? month : best,
            yearlyData[0],
          ),
        },
        message: "Yearly sales retrieved successfully",
      });
    } catch (error) {
      console.error("Get yearly sales error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch yearly sales",
      });
    }
  }

  /**
   * Get sales summary (overall statistics)
   */
  static async getSalesSummary(req: AuthRequest, res: Response) {
    try {
      const [summary, growth, salesByStatus] = await Promise.all([
        SalesService.getSalesSummary(),
        SalesService.getSalesGrowth(),
        SalesService.getSalesByStatus(),
      ]);

      res.status(200).json({
        success: true,
        data: {
          overall_summary: summary,
          growth_percentage: growth,
          sales_by_status: salesByStatus,
        },
        message: "Sales summary retrieved successfully",
      });
    } catch (error) {
      console.error("Get sales summary error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch sales summary",
      });
    }
  }

  /**
   * Get custom date range sales
   */
  static async getCustomRangeSales(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: "Start date and end date are required",
        });
      }

      const salesData = await SalesService.getCustomDateRangeSales(
        startDate as string,
        endDate as string,
      );

      res.status(200).json({
        success: true,
        data: salesData,
        message: "Custom range sales retrieved successfully",
      });
    } catch (error) {
      console.error("Get custom range sales error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch custom range sales",
      });
    }
  }

  /**
   * Get top selling products
   */
  static async getTopProducts(req: AuthRequest, res: Response) {
    try {
      const limit = parseInt(req.query.limit as string) || 10;

      const topProducts = await prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: {
          quantity: true,
        },
        orderBy: {
          _sum: {
            quantity: "desc",
          },
        },
        take: limit,
      });

      const productsWithDetails = await Promise.all(
        topProducts.map(async (item) => {
          const product = await prisma.product.findUnique({
            where: { id: item.productId },
            include: {
              images: {
                take: 1,
              },
              category: true,
            },
          });

          // Calculate total revenue from this product
          const orders = await prisma.orderItem.findMany({
            where: {
              productId: item.productId,
            },
            include: {
              order: true,
            },
          });

          const totalRevenue = orders.reduce(
            (sum, orderItem) =>
              sum + Number(orderItem.price) * orderItem.quantity,
            0,
          );

          return {
            ...product,
            totalSold: item._sum.quantity,
            totalRevenue,
          };
        }),
      );

      res.status(200).json({
        success: true,
        data: productsWithDetails,
        message: "Top products retrieved successfully",
      });
    } catch (error) {
      console.error("Get top products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch top products",
      });
    }
  }

  /**
   * Export sales report (CSV format)
   */
  static async exportSalesReport(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate } = req.query;

      let salesData;
      if (startDate && endDate) {
        salesData = await SalesService.getCustomDateRangeSales(
          startDate as string,
          endDate as string,
        );
      } else {
        // Default to last 30 days
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 30);
        salesData = await SalesService.getCustomDateRangeSales(
          start.toISOString(),
          end.toISOString(),
        );
      }

      // Create CSV content
      let csv =
        "Date,Total Sales,Total Orders,Average Order Value,Total Items Sold\n";

      for (const day of salesData.dailyBreakdown) {
        csv += `${new Date().toISOString().split("T")[0]},${day.totalSales},${day.totalOrders},${day.averageOrderValue},${day.totalItemsSold}\n`;
      }

      csv += `\nSummary\n`;
      csv += `Total Sales,${salesData.salesData.totalSales}\n`;
      csv += `Total Orders,${salesData.salesData.totalOrders}\n`;
      csv += `Average Order Value,${salesData.salesData.averageOrderValue}\n`;
      csv += `Total Items Sold,${salesData.salesData.totalItemsSold}\n`;
      csv += `Total Discounts,${salesData.salesData.totalDiscounts}\n`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=sales-report-${Date.now()}.csv`,
      );
      res.status(200).send(csv);
    } catch (error) {
      console.error("Export sales report error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to export sales report",
      });
    }
  }

  // Add this to sales.controller.ts
  static async getDashboardStats(req: AuthRequest, res: Response) {
    try {
      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const endOfYesterday = new Date(yesterday);
      endOfYesterday.setHours(23, 59, 59, 999);

      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());

      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const startOfYear = new Date(today.getFullYear(), 0, 1);

      // Growth periods
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const prev7Days = new Date(last7Days.getTime() - 7 * 24 * 60 * 60 * 1000);

      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const prev30Days = new Date(
        last30Days.getTime() - 30 * 24 * 60 * 60 * 1000,
      );

      const lastYear = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      const prevYear = new Date(lastYear.getTime() - 365 * 24 * 60 * 60 * 1000);

      // Optimized query helper
      const getStatsForRange = async (start: Date, end: Date) => {
        // Execute sequentially to respect connection limits
        const orderStats = await prisma.order.aggregate({
          where: {
            createdAt: { gte: start, lte: end },
            status: { not: "cancelled" },
            payment: { status: "paid" },
          },
          _sum: { totalAmount: true },
          _count: { id: true },
        });

        const itemStats = await prisma.orderItem.aggregate({
          where: {
            order: {
              createdAt: { gte: start, lte: end },
              status: { not: "cancelled" },
              payment: { status: "paid" },
            },
          },
          _sum: { quantity: true },
        });

        return {
          sales: Number(orderStats._sum.totalAmount || 0),
          orders: orderStats._count.id || 0,
          items: Number(itemStats._sum.quantity || 0),
        };
      };

      // Execute stats queries sequentially or in small batches to avoid pool timeouts
      // especially when connection_limit is low
      const todayStats = await getStatsForRange(today, endOfDay);
      const weekStats = await getStatsForRange(startOfWeek, now);
      const monthStats = await getStatsForRange(startOfMonth, now);
      const yearStats = await getStatsForRange(startOfYear, now);

      // Fetch lifetime and recent orders in a small parallel batch
      const [
        lifetimeOrderStats,
        lifetimeItemStats,
        uniqueCustomers,
        recentOrders,
      ] = await Promise.all([
        prisma.order.aggregate({
          where: { status: { not: "cancelled" }, payment: { status: "paid" } },
          _sum: { totalAmount: true },
          _count: { id: true },
        }),
        prisma.orderItem.aggregate({
          where: {
            order: {
              status: { not: "cancelled" },
              payment: { status: "paid" },
            },
          },
          _sum: { quantity: true },
        }),
        prisma.order.findMany({
          where: { status: { not: "cancelled" }, payment: { status: "paid" } },
          select: { userId: true },
          distinct: ["userId"],
        }),
        prisma.order.findMany({
          take: 10,
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
            payment: true,
          },
        }),
      ]);

      // Fetch growth comparison stats sequentially
      const yesterdayStats = await getStatsForRange(yesterday, endOfYesterday);
      const last7DaysStats = await getStatsForRange(last7Days, now);
      const prev7DaysStats = await getStatsForRange(prev7Days, last7Days);
      const last30DaysStats = await getStatsForRange(last30Days, now);
      const prev30DaysStats = await getStatsForRange(prev30Days, last30Days);
      const lastYearStats = await getStatsForRange(lastYear, now);
      const prevYearStats = await getStatsForRange(prevYear, lastYear);

      const calculateGrowth = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        const growth = ((current - previous) / previous) * 100;
        return Number(growth.toFixed(2));
      };

      res.status(200).json({
        success: true,
        data: {
          today: todayStats,
          this_week: weekStats,
          this_month: monthStats,
          this_year: yearStats,
          lifetime: {
            sales: Number(lifetimeOrderStats._sum.totalAmount || 0),
            orders: lifetimeOrderStats._count.id || 0,
            customers: uniqueCustomers.length,
            products_sold: Number(lifetimeItemStats._sum.quantity || 0),
          },
          growth: {
            daily: calculateGrowth(todayStats.sales, yesterdayStats.sales),
            weekly: calculateGrowth(last7DaysStats.sales, prev7DaysStats.sales),
            monthly: calculateGrowth(
              last30DaysStats.sales,
              prev30DaysStats.sales,
            ),
            yearly: calculateGrowth(lastYearStats.sales, prevYearStats.sales),
          },
          recent_orders: recentOrders,
        },
      });
    } catch (error) {
      console.error("Get dashboard stats error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch dashboard statistics",
      });
    }
  }
  /**
   * Get today's ordered products summary
   */
  static async getTodayOrderedProducts(req: AuthRequest, res: Response) {
    try {
      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const items = await prisma.orderItem.findMany({
        where: {
          order: {
            createdAt: { gte: today, lt: tomorrow },
            status: { in: ["pending", "confirmed"] },
          },
        },
        select: {
          productId: true,
          quantity: true,
          price: true,
          product: {
            select: {
              name: true,
              category: { select: { name: true } },
            },
          },
        },
      });

      const productMap = new Map<
        string,
        {
          id: string;
          productName: string;
          quantity: number;
          categoryName: string;
          totalPrice: number;
        }
      >();
      let grandTotalQuantity = 0;
      let grandTotalPrice = 0;

      items.forEach((item) => {
        let prod = productMap.get(item.productId);
        if (!prod) {
          prod = {
            id: item.productId,
            productName: item.product.name,
            quantity: 0,
            categoryName: item.product.category.name,
            totalPrice: 0,
          };
          productMap.set(item.productId, prod);
        }

        const itemTotalPrice = Number(item.price) * item.quantity;

        prod.quantity += item.quantity;
        prod.totalPrice += itemTotalPrice;

        grandTotalQuantity += item.quantity;
        grandTotalPrice += itemTotalPrice;
      });

      const orderedProducts = Array.from(productMap.values());

      res.status(200).json({
        success: true,
        data: {
          products: orderedProducts,
          summary: {
            totalProducts: orderedProducts.length,
            totalQuantity: grandTotalQuantity,
            totalRevenue: grandTotalPrice,
          },
        },
        message: "Today's ordered products retrieved successfully",
      });
    } catch (error) {
      console.error("Get today ordered products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch today's ordered products",
      });
    }
  }
}
