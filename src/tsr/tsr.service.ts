import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/supabase";
import {
  ORDER_STATUS_FILTERS,
  isValidOrderStatusFilter,
  isValidTSRStatus,
  TsrStatus,
  TSR_ALLOWED_STATUSES,
} from "./tsr.validation";

export interface TsrTerritory {
  divisionId: string;
  districtId: string;
  upazilaId: string;
}

export interface TsrTerritoryLookup {
  hasTerritory: boolean;
  territory?: TsrTerritory;
} 

export class TsrService {
  static async getAuthenticatedTSRTerritory(
    userId: string,
  ): Promise<TsrTerritoryLookup> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        divisionId: true,
        districtId: true,
        upazilaId: true,
      },
    });

    if (!user || user.role !== "TSR") {
      return { hasTerritory: false };
    }

    if (!user.divisionId || !user.districtId || !user.upazilaId) {
      return { hasTerritory: false };
    }

    return {
      hasTerritory: true,
      territory: {
        divisionId: user.divisionId,
        districtId: user.districtId,
        upazilaId: user.upazilaId,
      },
    };
  }

  static getOrderBaseInclude() {
    return {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          pharmacy_name: true,
          fullAddress: true,
          divisionId: true,
          districtId: true,
          upazilaId: true,
          division: {
            select: { id: true, code: true, name: true, bnName: true },
          },
          district: {
            select: { id: true, code: true, name: true, bnName: true },
          },
          upazila: {
            select: { id: true, code: true, name: true, bnName: true },
          },
        },
      },
      items: {
        include: {
          product: true,
        },
      },
      payment: true,
      shippingAddress: true,
    } as const;
  }

  static buildTerritoryWhere(territory: TsrTerritory): Prisma.OrderWhereInput {
    return {
      user: {
        is: {
          divisionId: territory.divisionId,
          districtId: territory.districtId,
          upazilaId: territory.upazilaId,
        },
      },
    };
  }

  static buildOrderQueryWhere(
    territory: TsrTerritory,
    filters?: {
      status?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    },
  ): Prisma.OrderWhereInput {
    const andClauses: Prisma.OrderWhereInput[] = [
      this.buildTerritoryWhere(territory),
    ];

    if (filters?.status) {
      const normalized = filters.status.trim();
      if (isValidOrderStatusFilter(normalized)) {
        andClauses.push({ status: normalized as OrderStatus });
      }
    }

    if (filters?.search) {
      const searchTerm = filters.search.trim();
      if (searchTerm) {
        andClauses.push({
          OR: [
            { id: { contains: searchTerm, mode: "insensitive" } },
            {
              user: {
                is: {
                  name: { contains: searchTerm, mode: "insensitive" },
                },
              },
            },
            {
              user: {
                is: {
                  pharmacy_name: { contains: searchTerm, mode: "insensitive" },
                },
              },
            },
            {
              user: {
                is: {
                  phone_number: { contains: searchTerm, mode: "insensitive" },
                },
              },
            },
          ],
        });
      }
    }

    if (filters?.startDate) {
      const start = new Date(filters.startDate);
      if (!Number.isNaN(start.getTime())) {
        andClauses.push({ createdAt: { gte: start } });
      }
    }

    if (filters?.endDate) {
      const end = new Date(filters.endDate);
      if (!Number.isNaN(end.getTime())) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 999);
        andClauses.push({ createdAt: { lte: endOfDay } });
      }
    }

    return {
      AND: andClauses,
    };
  }

  static async getOrdersForTSR(
    userId: string,
    query?: {
      page?: number;
      limit?: number;
      status?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    const territoryInfo = await this.getAuthenticatedTSRTerritory(userId);

    if (!territoryInfo.hasTerritory || !territoryInfo.territory) {
      return {
        success: true,
        data: {
          orders: [],
          pagination: {
            page: query?.page ?? 1,
            limit: query?.limit ?? 20,
            total: 0,
            totalPages: 0,
          },
        },
        message: "No TSR territory assigned. No orders available.",
      };
    }

    const page = Number(query?.page ?? 1) || 1;
    const limit = Number(query?.limit ?? 20) || 20;
    const skip = (page - 1) * limit;
    const where = this.buildOrderQueryWhere(territoryInfo.territory, {
      status: query?.status,
      search: query?.search,
      startDate: query?.startDate,
      endDate: query?.endDate,
    });

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: this.getOrderBaseInclude(),
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.order.count({ where }),
    ]);

    return {
      success: true,
      data: {
        orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      message: "TSR orders retrieved successfully",
    };
  }

  static async getOrderSummaryForTSR(userId: string) {
    const territoryInfo = await this.getAuthenticatedTSRTerritory(userId);

    if (!territoryInfo.hasTerritory || !territoryInfo.territory) {
      return {
        success: true,
        data: {
          totalOrders: 0,
          pending: 0,
          confirmed: 0,
          processing: 0,
          shipped: 0,
          delivered: 0,
          cancelled: 0,
        },
        message: "No TSR territory assigned. No orders available.",
      };
    }

    const where = this.buildTerritoryWhere(territoryInfo.territory);
    const totalOrders = await prisma.order.count({ where });
    const groupedStatuses = await prisma.order.groupBy({
      by: ["status"],
      where,
      _count: { status: true },
    });

    const counts: Record<string, number> = {
      totalOrders,
      pending: 0,
      confirmed: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
    };

    for (const item of groupedStatuses) {
      counts[item.status] = item._count.status;
    }

    return {
      success: true,
      data: {
        totalOrders: counts.totalOrders,
        pending: counts.pending,
        confirmed: counts.confirmed,
        processing: counts.processing,
        shipped: counts.shipped,
        delivered: counts.delivered,
        cancelled: counts.cancelled,
      },
      message: "TSR order summary retrieved successfully",
    };
  }

  static async getOrderByIdForTSR(userId: string, orderId: string) {
    const territoryInfo = await this.getAuthenticatedTSRTerritory(userId);

    if (!territoryInfo.hasTerritory || !territoryInfo.territory) {
      return { success: false, status: 404, error: "Order not found" };
    }

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        ...this.buildTerritoryWhere(territoryInfo.territory),
      },
      include: this.getOrderBaseInclude(),
    });

    if (!order) {
      return { success: false, status: 404, error: "Order not found" };
    }

    return {
      success: true,
      data: order,
    };
  }

  static async updateOrderStatusForTSR(
    userId: string,
    orderId: string,
    status: string,
  ) {
    if (!isValidTSRStatus(status)) {
      return {
        success: false,
        status: 400,
        error: "Invalid status",
      };
    }

    const territoryInfo = await this.getAuthenticatedTSRTerritory(userId);

    if (!territoryInfo.hasTerritory || !territoryInfo.territory) {
      return {
        success: false,
        status: 404,
        error: "Order not found",
      };
    }

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        ...this.buildTerritoryWhere(territoryInfo.territory),
      },
      include: {
        user: true,
      },
    });

    if (!order) {
      return {
        success: false,
        status: 404,
        error: "Order not found",
      };
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { status: status as TsrStatus },
      include: this.getOrderBaseInclude(),
    });

    await prisma.notification.create({
      data: {
        userId: order.userId,
        title: "Order Status Updated",
        message: `Your order #${orderId} status has been updated to: ${status}`,
        type: "order",
      },
    });

    return {
      success: true,
      data: updatedOrder,
      message: "Order status updated successfully",
    };
  }
}
