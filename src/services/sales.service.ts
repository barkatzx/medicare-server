// src/services/sales.service.ts
import { prisma } from "../config/supabase";
import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";

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
   * Get shipped and delivered sales from the last 7 local calendar days.
   */
  static async getWeeklySales(): Promise<TimeRangeSales[]> {
    const now = new Date();
    return this.getSalesByStatusByDay(now, 7, [
      OrderStatus.shipped,
      OrderStatus.delivered,
    ]);
  }

  /**
   * Get delivered sales from the last 30 local calendar days
   */
  static async getMonthlySales(): Promise<TimeRangeSales[]> {
    const now = new Date();
    return this.getSalesByStatusByDay(now, 30, [OrderStatus.delivered]);
  }

  /**
   * Get delivered sales from the last year, grouped into 12 rolling months
   */
  static async getYearlySales(): Promise<TimeRangeSales[]> {
    const now = new Date();
    const monthBoundaries = Array.from({ length: 13 }, (_, index) =>
      this.getMonthOffset(now, index - 12),
    );
    monthBoundaries[12] = now;

    const orders = await this.getOrdersByStatus(
      monthBoundaries[0],
      now,
      [OrderStatus.delivered],
    );

    return monthBoundaries.slice(0, 12).map((start, index) => {
      const end = monthBoundaries[index + 1];
      const monthOrders = orders.filter(
        (order) =>
          order.createdAt >= start &&
          (index === 11 ? order.createdAt <= end : order.createdAt < end),
      );
      return this.getTimeRangeSales(monthOrders, "monthly");
    });
  }

  private static async getSalesByStatusByDay(
    now: Date,
    dayCount: number,
    statuses: OrderStatus[],
  ): Promise<TimeRangeSales[]> {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (dayCount - 1));

    const orders = await this.getOrdersByStatus(start, now, statuses);
    const dailyOrders = new Map<string, typeof orders>();
    const days: Date[] = [];

    for (let index = 0; index < dayCount; index++) {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      days.push(day);
      dailyOrders.set(this.getLocalDateKey(day), []);
    }

    for (const order of orders) {
      const dayOrders = dailyOrders.get(this.getLocalDateKey(order.createdAt));
      if (!dayOrders) {
        throw new Error("Order fell outside the daily sales buckets");
      }
      dayOrders.push(order);
    }

    return days.map((day) =>
      this.getTimeRangeSales(
        dailyOrders.get(this.getLocalDateKey(day)) ?? [],
        "daily",
      ),
    );
  }

  private static async getOrdersByStatus(
    start: Date,
    end: Date,
    statuses: OrderStatus[],
  ) {
    return prisma.order.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
        status: {
          in: statuses,
        },
      },
      include: {
        items: true,
      },
    });
  }

  private static getTimeRangeSales(
    orders: Array<{
      totalAmount: unknown;
      items: Array<{ quantity: number }>;
    }>,
    period: string,
  ): TimeRangeSales {
    const totalSales = orders.reduce(
      (sum, order) => sum + Number(order.totalAmount),
      0,
    );
    const totalOrders = orders.length;

    return {
      period,
      totalSales,
      totalOrders,
      averageOrderValue: totalOrders > 0 ? totalSales / totalOrders : 0,
      totalItemsSold: orders.reduce(
        (sum, order) =>
          sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
        0,
      ),
    };
  }

  private static getLocalDateKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  private static getMonthOffset(date: Date, offset: number): Date {
    const result = new Date(date);
    const dayOfMonth = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + offset);
    const lastDayOfMonth = new Date(
      result.getFullYear(),
      result.getMonth() + 1,
      0,
    ).getDate();
    result.setDate(Math.min(dayOfMonth, lastDayOfMonth));
    return result;
  }

  /**
   * Get sales summary (overall totals)
   */
  static async getSalesSummary(): Promise<
    SalesData & {
      totalCustomers: number;
      topProducts: any[];
      topCategories: any[];
      topCustomers: Array<{
        id: string;
        customerName: string | null;
        pharmacyName: string | null;
        totalOrders: number;
        totalSales: number;
      }>;
    }
  > {
    const dateRange = {
      startDate: new Date(0),
      endDate: new Date(),
    };
    const [
      allTimeData,
      totalCustomers,
      productsWithDetails,
      categoriesWithDetails,
      customersWithDetails,
    ] =
      await Promise.all([
        this.getSummarySalesData(dateRange),
        this.getUniqueCustomerCount(),
        this.getTopProductsBySales(),
        this.getTopCategoriesBySales(),
        this.getTopCustomersBySales(dateRange),
      ]);

    return {
      ...allTimeData,
      totalCustomers,
      topProducts: productsWithDetails,
      topCategories: categoriesWithDetails,
      topCustomers: customersWithDetails,
    };
  }

  private static async getUniqueCustomerCount(): Promise<number> {
    const [result] = await prisma.$queryRaw<
      Array<{ totalCustomers: number }>
    >(Prisma.sql`
      SELECT COUNT(DISTINCT o."userId")::int AS "totalCustomers"
      FROM "Order" o
      INNER JOIN "Payment" payment ON payment."orderId" = o."id"
      WHERE o."status" <> ${OrderStatus.cancelled}::"OrderStatus"
        AND payment."status" = ${PaymentStatus.paid}::"PaymentStatus"
    `);
    return result.totalCustomers;
  }

  private static async getSummarySalesData(dateRange: {
    startDate: Date;
    endDate: Date;
  }): Promise<SalesData> {
    const { startDate, endDate } = dateRange;
    const eligibleOrderFilter = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      status: {
        not: OrderStatus.cancelled,
      },
      payment: {
        status: PaymentStatus.paid,
      },
    };

    const [orderTotals, itemTotals, discountTotal] = await Promise.all([
      prisma.order.aggregate({
        where: eligibleOrderFilter,
        _sum: {
          totalAmount: true,
        },
        _count: {
          _all: true,
        },
      }),
      prisma.orderItem.aggregate({
        where: {
          order: eligibleOrderFilter,
        },
        _sum: {
          quantity: true,
        },
      }),
      prisma.$queryRaw<Array<{ totalDiscounts: Prisma.Decimal | null }>>(
        Prisma.sql`
          SELECT SUM(
            CASE
              WHEN p."price" > oi."price"
              THEN (p."price" - oi."price") * oi."quantity"
              ELSE 0
            END
          ) AS "totalDiscounts"
          FROM "OrderItem" oi
          INNER JOIN "Order" o ON o."id" = oi."orderId"
          INNER JOIN "Payment" payment ON payment."orderId" = o."id"
          INNER JOIN "Product" p ON p."id" = oi."productId"
          WHERE o."createdAt" >= ${startDate}
            AND o."createdAt" <= ${endDate}
            AND o."status" <> ${OrderStatus.cancelled}::"OrderStatus"
            AND payment."status" = ${PaymentStatus.paid}::"PaymentStatus"
        `,
      ),
    ]);

    const totalSales = Number(orderTotals._sum.totalAmount ?? 0);
    const totalOrders = orderTotals._count._all;
    const totalDiscounts = Number(discountTotal[0]?.totalDiscounts ?? 0);

    return {
      totalSales,
      totalOrders,
      averageOrderValue: totalOrders > 0 ? totalSales / totalOrders : 0,
      totalItemsSold: itemTotals._sum.quantity ?? 0,
      totalDiscounts,
    };
  }

  private static async getTopCustomersBySales(dateRange: {
    startDate: Date;
    endDate: Date;
  }): Promise<
    Array<{
      id: string;
      customerName: string | null;
      pharmacyName: string | null;
      totalOrders: number;
      totalSales: number;
    }>
  > {
    const customers = await prisma.$queryRaw<
      Array<{
        id: string;
        customerName: string | null;
        pharmacyName: string | null;
        totalOrders: number;
        totalSales: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT
        u."id",
        u."name" AS "customerName",
        u."pharmacy_name" AS "pharmacyName",
        COUNT(o."id")::int AS "totalOrders",
        SUM(o."totalAmount") AS "totalSales"
      FROM "Order" o
      INNER JOIN "User" u ON u."id" = o."userId"
      INNER JOIN "Payment" payment ON payment."orderId" = o."id"
      WHERE o."createdAt" >= ${dateRange.startDate}
        AND o."createdAt" <= ${dateRange.endDate}
        AND o."status" <> ${OrderStatus.cancelled}::"OrderStatus"
        AND payment."status" = ${PaymentStatus.paid}::"PaymentStatus"
      GROUP BY u."id", u."name", u."pharmacy_name"
      ORDER BY COUNT(o."id") DESC, SUM(o."totalAmount") DESC
      LIMIT 10
    `);

    return customers.map((customer) => ({
      ...customer,
      totalSales: Number(customer.totalSales),
    }));
  }

  private static async getTopProductsBySales(): Promise<
    Array<{
      id: string;
      name: string;
      price: Prisma.Decimal;
      images: Array<{ url: string }>;
      totalSold: number;
    }>
  > {
    const products = await prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        price: Prisma.Decimal;
        imageUrl: string | null;
        totalSold: number;
      }>
    >(Prisma.sql`
      SELECT
        p."id",
        p."name",
        p."price",
        (
          SELECT pi."url"
          FROM "ProductImage" pi
          WHERE pi."productId" = p."id"
          ORDER BY pi."createdAt"
          LIMIT 1
        ) AS "imageUrl",
        SUM(oi."quantity")::double precision AS "totalSold"
      FROM "OrderItem" oi
      INNER JOIN "Product" p ON p."id" = oi."productId"
      GROUP BY p."id", p."name", p."price"
      ORDER BY SUM(oi."quantity") DESC
      LIMIT 10
    `);

    return products.map(({ imageUrl, ...product }) => ({
      ...product,
      images: imageUrl ? [{ url: imageUrl }] : [],
    }));
  }

  private static async getTopCategoriesBySales(): Promise<
    Array<{ id: string; name: string; totalSold: number }>
  > {
    return prisma.$queryRaw<
      Array<{ id: string; name: string; totalSold: number }>
    >(Prisma.sql`
      SELECT
        c."id",
        c."name",
        SUM(oi."quantity")::double precision AS "totalSold"
      FROM "OrderItem" oi
      INNER JOIN "Product" p ON p."id" = oi."productId"
      INNER JOIN "Category" c ON c."id" = p."categoryId"
      GROUP BY c."id", c."name"
      ORDER BY SUM(oi."quantity") DESC
      LIMIT 10
    `);
  }

  /**
   * Get sales by status
   */
  static async getSalesByStatus(): Promise<
    Array<{ status: OrderStatus; totalSales: number; totalOrders: number }>
  > {
    const statuses: OrderStatus[] = [
      OrderStatus.pending,
      OrderStatus.confirmed,
      OrderStatus.processing,
      OrderStatus.shipped,
      OrderStatus.delivered,
      OrderStatus.cancelled,
    ];
    const dateRange = {
      gte: new Date(0),
      lte: new Date(),
    };
    const ordersByStatus = await prisma.order.groupBy({
      by: ["status"],
      where: {
        createdAt: dateRange,
        status: {
          in: statuses,
        },
      },
      _sum: {
        totalAmount: true,
      },
      _count: {
        _all: true,
      },
    });

    const statusTotals = new Map(
      ordersByStatus.map((group) => [group.status, group]),
    );
    return statuses.map((status) => {
      const totals = statusTotals.get(status);
      return {
        status,
        totalSales: Number(totals?._sum.totalAmount ?? 0),
        totalOrders: totals?._count._all ?? 0,
      };
    });
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
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    const dailyStatuses = [OrderStatus.pending, OrderStatus.confirmed];
    const weeklyStatuses = [OrderStatus.shipped, OrderStatus.delivered];
    const deliveredStatuses = [OrderStatus.delivered];
    const statusFilter = (statuses: OrderStatus[]) =>
      Prisma.join(
        statuses.map((status) => Prisma.sql`${status}::"OrderStatus"`),
      );

    const weeklyStart = new Date(now);
    weeklyStart.setHours(0, 0, 0, 0);
    weeklyStart.setDate(weeklyStart.getDate() - 6);
    const previousWeeklyStart = this.getPeriodStart(weeklyStart, "days", 7);

    const monthlyStart = new Date(now);
    monthlyStart.setHours(0, 0, 0, 0);
    monthlyStart.setDate(monthlyStart.getDate() - 29);
    const previousMonthlyStart = this.getPeriodStart(monthlyStart, "days", 30);

    const yearlyStart = this.getPeriodStart(now, "years", 1);
    const previousYearlyStart = this.getPeriodStart(yearlyStart, "years", 1);
    const previousYearlyEnd = new Date(yearlyStart.getTime() - 1);

    const [totals] = await prisma.$queryRaw<
      Array<{
        dailyCurrent: Prisma.Decimal | null;
        dailyPrevious: Prisma.Decimal | null;
        weeklyCurrent: Prisma.Decimal | null;
        weeklyPrevious: Prisma.Decimal | null;
        monthlyCurrent: Prisma.Decimal | null;
        monthlyPrevious: Prisma.Decimal | null;
        yearlyCurrent: Prisma.Decimal | null;
        yearlyPrevious: Prisma.Decimal | null;
      }>
    >(Prisma.sql`
      SELECT
        SUM(CASE
          WHEN o."createdAt" >= ${startOfToday}
            AND o."createdAt" <= ${now}
            AND o."status" IN (${statusFilter(dailyStatuses)})
          THEN o."totalAmount" ELSE 0 END) AS "dailyCurrent",
        SUM(CASE
          WHEN o."createdAt" >= ${startOfYesterday}
            AND o."createdAt" <= ${new Date(startOfToday.getTime() - 1)}
            AND o."status" IN (${statusFilter(dailyStatuses)})
          THEN o."totalAmount" ELSE 0 END) AS "dailyPrevious",
        SUM(CASE
          WHEN o."createdAt" >= ${weeklyStart}
            AND o."createdAt" <= ${now}
            AND o."status" IN (${statusFilter(weeklyStatuses)})
          THEN o."totalAmount" ELSE 0 END) AS "weeklyCurrent",
        SUM(CASE
          WHEN o."createdAt" >= ${previousWeeklyStart}
            AND o."createdAt" <= ${new Date(weeklyStart.getTime() - 1)}
            AND o."status" IN (${statusFilter(weeklyStatuses)})
          THEN o."totalAmount" ELSE 0 END) AS "weeklyPrevious",
        SUM(CASE
          WHEN o."createdAt" >= ${monthlyStart}
            AND o."createdAt" <= ${now}
            AND o."status" IN (${statusFilter(deliveredStatuses)})
          THEN o."totalAmount" ELSE 0 END) AS "monthlyCurrent",
        SUM(CASE
          WHEN o."createdAt" >= ${previousMonthlyStart}
            AND o."createdAt" <= ${new Date(monthlyStart.getTime() - 1)}
            AND o."status" IN (${statusFilter(deliveredStatuses)})
          THEN o."totalAmount" ELSE 0 END) AS "monthlyPrevious",
        SUM(CASE
          WHEN o."createdAt" >= ${yearlyStart}
            AND o."createdAt" <= ${now}
            AND o."status" IN (${statusFilter(deliveredStatuses)})
          THEN o."totalAmount" ELSE 0 END) AS "yearlyCurrent",
        SUM(CASE
          WHEN o."createdAt" >= ${previousYearlyStart}
            AND o."createdAt" <= ${previousYearlyEnd}
            AND o."status" IN (${statusFilter(deliveredStatuses)})
          THEN o."totalAmount" ELSE 0 END) AS "yearlyPrevious"
      FROM "Order" o
      WHERE o."createdAt" >= ${previousYearlyStart}
        AND o."createdAt" <= ${now}
        AND o."status" IN (${statusFilter([
          ...dailyStatuses,
          ...weeklyStatuses,
          ...deliveredStatuses,
        ])})
    `);

    const calculateGrowth = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(2));
    };

    return {
      daily: calculateGrowth(
        Number(totals.dailyCurrent ?? 0),
        Number(totals.dailyPrevious ?? 0),
      ),
      weekly: calculateGrowth(
        Number(totals.weeklyCurrent ?? 0),
        Number(totals.weeklyPrevious ?? 0),
      ),
      monthly: calculateGrowth(
        Number(totals.monthlyCurrent ?? 0),
        Number(totals.monthlyPrevious ?? 0),
      ),
      yearly: calculateGrowth(
        Number(totals.yearlyCurrent ?? 0),
        Number(totals.yearlyPrevious ?? 0),
      ),
    };
  }

  private static getPeriodStart(
    date: Date,
    unit: "days" | "years",
    amount: number,
  ): Date {
    const result = new Date(date);
    if (unit === "days") {
      result.setDate(result.getDate() - amount);
    } else {
      result.setFullYear(result.getFullYear() - amount);
    }
    return result;
  }
}
