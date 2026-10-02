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
   * Get today's ordered products summary
   */
  static async getTodayOrderedProducts(req: AuthRequest, res: Response) {
    try {
      const items = await prisma.orderItem.findMany({
        where: {
          order: {
            status: { in: ["pending", "confirmed"] },
          },
        },
        select: {
          productId: true,
          quantity: true,
          product: {
            select: {
              id: true,
              name: true,
              distributor: true,
              price: true,
              tp: true,
            },
          },
        },
      });

      const productMap = new Map<
        string,
        {
          productName: string;
          distributor: string | null;
          quantity: number;
          price: number;
          tp: number | null;
        }
      >();
      let grandTotalQuantity = 0;
      let grandTotalPrice = 0;

      items.forEach((item) => {
        let prod = productMap.get(item.product.id);
        if (!prod) {
          prod = {
            productName: item.product.name,
            distributor: item.product.distributor,
            quantity: 0,
            price: Number(item.product.price),
            tp: item.product.tp == null ? null : Number(item.product.tp),
          };
          productMap.set(item.product.id, prod);
        }

        prod.quantity += item.quantity;
        grandTotalQuantity += item.quantity;
        grandTotalPrice += prod.price * item.quantity;
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
        message: "Ordered products retrieved successfully",
      });
    } catch (error) {
      console.error("Get ordered products error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch ordered products",
      });
    }
  }
}
