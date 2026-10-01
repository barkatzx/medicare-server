// src/services/sales.service.ts
import { prisma } from "../config/supabase";
import { OrderStatus, PaymentStatus } from "@prisma/client";

export interface SalesData {
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
  totalItemsSold: number;
  totalDiscounts: number;
}

export interface TimeRangeSales {
  period: string;
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
  totalItemsSold: number;
}

export class SalesService {
  /**
   * Get total sales for a specific date range
   */
  static async getSalesData(
    startDate: Date,
    endDate: Date,
  ): Promise<SalesData> {
    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          not: "cancelled", // Exclude cancelled orders
        },
        payment: {
          status: "paid", // Only count paid orders
        },
      },
      include: {
        items: true,
        payment: true,
      },
    });

    const totalSales = orders.reduce(
      (sum, order) => sum + Number(order.totalAmount),
      0,
    );
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
    const totalItemsSold = orders.reduce(
      (sum, order) =>
        sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0,
    );

    // Calculate total discounts (original price - paid amount)
    let totalDiscounts = 0;
    for (const order of orders) {
      for (const item of order.items) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
        });
        if (product && Number(product.price) > Number(item.price)) {
          totalDiscounts +=
            (Number(product.price) - Number(item.price)) * item.quantity;
        }
      }
    }

    return {
      totalSales,
      totalOrders,
      averageOrderValue,
      totalItemsSold,
      totalDiscounts,
    };
  }

  /**
   * Get pending and confirmed sales across all dates
   */
  static async getDailySales(): Promise<
    TimeRangeSales & { totalDiscounts: number }
  > {
    const orders = await prisma.order.findMany({
      where: {
        status: {
          in: [OrderStatus.pending, OrderStatus.confirmed],
        },
      },
      include: {
        items: true,
      },
    });

    const totalSales = orders.reduce(
      (sum, order) => sum + Number(order.totalAmount),
      0,
    );
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
    const totalItemsSold = orders.reduce(
      (sum, order) =>
        sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0,
    );

    let totalDiscounts = 0;
    for (const order of orders) {
      for (const item of order.items) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
        });
        if (product && Number(product.price) > Number(item.price)) {
          totalDiscounts +=
            (Number(product.price) - Number(item.price)) * item.quantity;
        }
      }
    }

    return {
      period: "daily",
      totalSales,
      totalOrders,
      averageOrderValue,
      totalItemsSold,
      totalDiscounts,
    };
  }

  /**
   * Get sales for a specific date using the existing paid-order criteria.
   */
  private static async getDailySalesForDate(
    date: Date,
  ): Promise<TimeRangeSales & { date: string }> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const salesData = await this.getSalesData(startOfDay, endOfDay);

    return {
      period: "daily",
      date: startOfDay.toISOString().split("T")[0],
      totalSales: salesData.totalSales,
      totalOrders: salesData.totalOrders,
      averageOrderValue: salesData.averageOrderValue,
      totalItemsSold: salesData.totalItemsSold,
    };
  }

  /**
   * Get weekly sales (last 7 days)
   */
  static async getWeeklySales(): Promise<TimeRangeSales[]> {
    const weeklyData: TimeRangeSales[] = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);

      const dayData = await this.getDailySalesForDate(date);
      weeklyData.push({
        period: "daily",
        totalSales: dayData.totalSales,
        totalOrders: dayData.totalOrders,
        averageOrderValue: dayData.averageOrderValue,
        totalItemsSold: dayData.totalItemsSold,
      });
    }

    return weeklyData;
  }

  /**
   * Get monthly sales (last 30 days)
   */
  static async getMonthlySales(): Promise<TimeRangeSales[]> {
    const monthlyData: TimeRangeSales[] = [];
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);

      const dayData = await this.getDailySalesForDate(date);
      monthlyData.push({
        period: "daily",
        totalSales: dayData.totalSales,
        totalOrders: dayData.totalOrders,
        averageOrderValue: dayData.averageOrderValue,
        totalItemsSold: dayData.totalItemsSold,
      });
    }

    return monthlyData;
  }

  /**
   * Get yearly sales (last 12 months)
   */
  static async getYearlySales(): Promise<TimeRangeSales[]> {
    const yearlyData: TimeRangeSales[] = [];
    const today = new Date();

    for (let i = 11; i >= 0; i--) {
      const startOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() - i,
        1,
      );
      const endOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() - i + 1,
        0,
        23,
        59,
        59,
        999,
      );

      const orders = await prisma.order.findMany({
        where: {
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
          status: {
            not: "cancelled",
          },
          payment: {
            status: "paid",
          },
        },
        include: {
          items: true,
        },
      });

      const totalSales = orders.reduce(
        (sum, order) => sum + Number(order.totalAmount),
        0,
      );
      const totalOrders = orders.length;
      const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
      const totalItemsSold = orders.reduce(
        (sum, order) =>
          sum +
          order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
        0,
      );

      yearlyData.push({
        period: "monthly",
        totalSales,
        totalOrders,
        averageOrderValue,
        totalItemsSold,
      });
    }

    return yearlyData;
  }

  /**
   * Get sales summary (overall totals)
   */
  static async getSalesSummary(): Promise<
    SalesData & {
      totalCustomers: number;
      topProducts: any[];
      topCategories: any[];
    }
  > {
    const allTimeData = await this.getSalesData(
      new Date(0), // From beginning of time
      new Date(), // Until now
    );

    // Get unique customers who made purchases
    const uniqueCustomers = await prisma.order.findMany({
      where: {
        status: { not: "cancelled" },
        payment: { status: "paid" },
      },
      select: {
        userId: true,
      },
      distinct: ["userId"],
    });

    // Get top 10 selling products
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
      take: 10,
    });

    const productsWithDetails = await Promise.all(
      topProducts.map(async (item) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: {
            id: true,
            name: true,
            price: true,
            images: {
              take: 1,
              select: {
                url: true,
              },
            },
          },
        });
        return {
          ...product,
          totalSold: item._sum.quantity,
        };
      }),
    );

    // Get top categories by sales
    const topCategories = await prisma.orderItem.groupBy({
      by: ["productId"],
      _sum: {
        quantity: true,
      },
    });

    const categorySales: { [key: string]: number } = {};
    for (const item of topCategories) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { categoryId: true },
      });
      if (product) {
        categorySales[product.categoryId] =
          (categorySales[product.categoryId] || 0) + (item._sum.quantity || 0);
      }
    }

    const categoriesWithDetails = await Promise.all(
      Object.entries(categorySales)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(async ([categoryId, totalSold]) => {
          const category = await prisma.category.findUnique({
            where: { id: categoryId },
            select: {
              id: true,
              name: true,
            },
          });
          return {
            ...category,
            totalSold,
          };
        }),
    );

    return {
      ...allTimeData,
      totalCustomers: uniqueCustomers.length,
      topProducts: productsWithDetails,
      topCategories: categoriesWithDetails,
    };
  }

  /**
   * Get sales by status
   */
  static async getSalesByStatus(): Promise<any> {
    const statuses = [
      "pending",
      "confirmed",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];
    const salesByStatus = [];

    for (const status of statuses) {
      const orders = await prisma.order.findMany({
        where: {
          status: status as OrderStatus,
          payment: {
            status: "paid",
          },
        },
      });

      const totalSales = orders.reduce(
        (sum, order) => sum + Number(order.totalAmount),
        0,
      );
      const totalOrders = orders.length;

      salesByStatus.push({
        status,
        totalSales,
        totalOrders,
      });
    }

    return salesByStatus;
  }

  /**
   * Get custom date range sales
   */
  static async getCustomDateRangeSales(
    startDate: string,
    endDate: string,
  ): Promise<{
    salesData: SalesData;
    dailyBreakdown: TimeRangeSales[];
  }> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const salesData = await this.getSalesData(start, end);

    // Get daily breakdown
    const dailyBreakdown: TimeRangeSales[] = [];
    const currentDate = new Date(start);

    while (currentDate <= end) {
      const dayData = await this.getDailySalesForDate(currentDate);
      dailyBreakdown.push({
        period: "daily",
        totalSales: dayData.totalSales,
        totalOrders: dayData.totalOrders,
        averageOrderValue: dayData.averageOrderValue,
        totalItemsSold: dayData.totalItemsSold,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
      salesData,
      dailyBreakdown,
    };
  }

  /**
   * Get sales growth percentage
   */
  static async getSalesGrowth(): Promise<{
    daily: number;
    weekly: number;
    monthly: number;
    yearly: number;
  }> {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);

    const lastMonth = new Date(today);
    lastMonth.setMonth(today.getMonth() - 1);

    const lastYear = new Date(today);
    lastYear.setFullYear(today.getFullYear() - 1);

    const todaySales = await this.getDailySalesForDate(today);
    const yesterdaySales = await this.getDailySalesForDate(yesterday);

    const thisWeekSales = await this.getSalesData(lastWeek, today);
    const lastWeekSales = await this.getSalesData(
      new Date(lastWeek.getTime() - 7 * 24 * 60 * 60 * 1000),
      lastWeek,
    );

    const thisMonthSales = await this.getSalesData(lastMonth, today);
    const lastMonthSales = await this.getSalesData(
      new Date(lastMonth.getTime() - 30 * 24 * 60 * 60 * 1000),
      lastMonth,
    );

    const thisYearSales = await this.getSalesData(lastYear, today);
    const lastYearSales = await this.getSalesData(
      new Date(lastYear.getTime() - 365 * 24 * 60 * 60 * 1000),
      lastYear,
    );

    const calculateGrowth = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    return {
      daily: calculateGrowth(todaySales.totalSales, yesterdaySales.totalSales),
      weekly: calculateGrowth(
        thisWeekSales.totalSales,
        lastWeekSales.totalSales,
      ),
      monthly: calculateGrowth(
        thisMonthSales.totalSales,
        lastMonthSales.totalSales,
      ),
      yearly: calculateGrowth(
        thisYearSales.totalSales,
        lastYearSales.totalSales,
      ),
    };
  }
}
