import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/supabase";
import { AdminTsrSalesOrderFilters } from "./admin-tsr-sales.validation";

interface Territory {
  divisionId: string;
  districtId: string;
  upazilaId: string;
}

type StatusTotals = Record<OrderStatus, { count: number; value: number }>;

interface SalesTotals {
  totalOrders: number;
  totalOrderValue: number;
  statuses: StatusTotals;
}

interface TsrPeriodTotals {
  tsrId: string;
  tsrName: string | null;
  divisionId: string | null;
  districtId: string | null;
  upazilaId: string | null;
  division: { id: string; name: string; bnName?: string | null } | null;
  district: { id: string; name: string; bnName?: string | null } | null;
  upazila: { id: string; name: string; bnName?: string | null } | null;
  totalOrders: number;
  totalOrderValue: number;
  statuses: Partial<StatusTotals>;
}

type TsrRanking = Omit<TsrPeriodTotals, "statuses">;

type OrderGroup = {
  userId: string;
  status: OrderStatus;
  _count: { _all: number };
  _sum: { totalAmount: Prisma.Decimal | null };
};

interface PeriodDefinition {
  statuses: OrderStatus[];
  startDate?: Date;
  endDate?: Date;
}

const zeroStatusTotals = (): StatusTotals => ({
  [OrderStatus.pending]: { count: 0, value: 0 },
  [OrderStatus.confirmed]: { count: 0, value: 0 },
  [OrderStatus.processing]: { count: 0, value: 0 },
  [OrderStatus.shipped]: { count: 0, value: 0 },
  [OrderStatus.delivered]: { count: 0, value: 0 },
  [OrderStatus.cancelled]: { count: 0, value: 0 },
});

const zeroSalesTotals = (): SalesTotals => ({
  totalOrders: 0,
  totalOrderValue: 0,
  statuses: zeroStatusTotals(),
});

const buildTerritoryWhere = (territory: Territory): Prisma.OrderWhereInput => ({
  user: {
    is: {
      divisionId: territory.divisionId,
      districtId: territory.districtId,
      upazilaId: territory.upazilaId,
    },
  },
});

const getStatusTotals = async (
  where: Prisma.OrderWhereInput = {},
): Promise<SalesTotals> => {
  const [grouped, aggregate] = await Promise.all([
    prisma.order.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.order.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
  ]);
  const totals = zeroStatusTotals();

  for (const group of grouped) {
    totals[group.status] = {
      count: group._count._all,
      value: Number(group._sum.totalAmount ?? 0),
    };
  }

  return {
    totalOrders: aggregate._count._all,
    totalOrderValue: Number(aggregate._sum.totalAmount ?? 0),
    statuses: totals,
  };
};

const summarizeTotals = (totals: SalesTotals) => {
  return {
    totalOrders: totals.totalOrders,
    totalOrderValue: totals.totalOrderValue,
    ...totals.statuses,
  };
};

const territoryKey = (territory: Territory) =>
  `${territory.divisionId}:${territory.districtId}:${territory.upazilaId}`;

const getMonthOffset = (date: Date, offset: number): Date => {
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
};

const getOrderInclude = () => ({
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
      division: { select: { id: true, name: true, bnName: true } },
      district: { select: { id: true, name: true, bnName: true } },
      upazila: { select: { id: true, name: true, bnName: true } },
    },
  },
});

export class AdminTsrSalesService {
  static async getAllSummary(tsrId?: string) {
    const tsrs = await prisma.user.findMany({
      where: { role: "TSR", ...(tsrId ? { id: tsrId } : {}) },
      select: {
        id: true,
        name: true,
        divisionId: true,
        districtId: true,
        upazilaId: true,
        division: { select: { id: true, name: true, bnName: true } },
        district: { select: { id: true, name: true, bnName: true } },
        upazila: { select: { id: true, name: true, bnName: true } },
      },
      orderBy: { name: "asc" },
    });

    if (tsrId && tsrs.length === 0) return null;

    const tsrsByTerritory = new Map<string, typeof tsrs>();
    for (const tsr of tsrs) {
      if (!tsr.divisionId || !tsr.districtId || !tsr.upazilaId) continue;
      const key = territoryKey({
        divisionId: tsr.divisionId,
        districtId: tsr.districtId,
        upazilaId: tsr.upazilaId,
      });
      const territoryTsrs = tsrsByTerritory.get(key) ?? [];
      territoryTsrs.push(tsr);
      tsrsByTerritory.set(key, territoryTsrs);
    }

    const territories = [...tsrsByTerritory.keys()].map((key) => {
      const [divisionId, districtId, upazilaId] = key.split(":");
      return { divisionId, districtId, upazilaId };
    });

    const now = new Date();
    const weeklyStart = new Date(now);
    weeklyStart.setHours(0, 0, 0, 0);
    weeklyStart.setDate(weeklyStart.getDate() - 6);

    const monthlyStart = new Date(now);
    monthlyStart.setHours(0, 0, 0, 0);
    monthlyStart.setDate(monthlyStart.getDate() - 29);

    const periods: Record<string, PeriodDefinition> = {
      today: {
        statuses: [OrderStatus.pending, OrderStatus.confirmed],
      },
      weekly: {
        statuses: [OrderStatus.shipped, OrderStatus.delivered],
        startDate: weeklyStart,
        endDate: now,
      },
      monthly: {
        statuses: [OrderStatus.delivered],
        startDate: monthlyStart,
        endDate: now,
      },
      yearly: {
        statuses: [OrderStatus.delivered],
        startDate: getMonthOffset(now, -12),
        endDate: now,
      },
    };

    const periodGroups: Array<[string, OrderGroup[]]> = await Promise.all(
      Object.entries(periods).map(
        async ([period, definition]): Promise<[string, OrderGroup[]]> => {
          if (territories.length === 0) return [period, []];

          const where: Prisma.OrderWhereInput = {
            status: { in: definition.statuses },
            user: {
              is: {
                OR: territories,
              },
            },
          };

          if (definition.startDate && definition.endDate) {
            where.createdAt = {
              gte: definition.startDate,
              lte: definition.endDate,
            };
          }

          const groups = await prisma.order.groupBy({
            by: ["userId", "status"],
            where,
            _count: { _all: true },
            _sum: { totalAmount: true },
          });
          return [period, groups];
        },
      ),
    );

    const groupsByPeriod = new Map<string, OrderGroup[]>(periodGroups);
    const customerIds = [
      ...new Set(
        periodGroups.flatMap(([, groups]) =>
          groups.map((group) => group.userId),
        ),
      ),
    ];
    const customers = customerIds.length
      ? await prisma.user.findMany({
          where: { id: { in: customerIds } },
          select: {
            id: true,
            divisionId: true,
            districtId: true,
            upazilaId: true,
          },
        })
      : [];
    const customerTerritories = new Map(
      customers.map((customer) => [
        customer.id,
        customer.divisionId && customer.districtId && customer.upazilaId
          ? territoryKey({
              divisionId: customer.divisionId,
              districtId: customer.districtId,
              upazilaId: customer.upazilaId,
            })
          : null,
      ]),
    );

    const buildPeriodSummary = (
      period: string,
      statuses: OrderStatus[],
    ) => {
      const total = { totalOrders: 0, totalOrderValue: 0 };
      const statusTotals = Object.fromEntries(
        statuses.map((status) => [status, { count: 0, value: 0 }]),
      ) as Partial<StatusTotals>;
      const tsrTotals = new Map<string, TsrPeriodTotals>(
        tsrs.map((tsr) => [
          tsr.id,
          {
            tsrId: tsr.id,
            tsrName: tsr.name,
            divisionId: tsr.divisionId ?? null,
            districtId: tsr.districtId ?? null,
            upazilaId: tsr.upazilaId ?? null,
            division: tsr.division ?? null,
            district: tsr.district ?? null,
            upazila: tsr.upazila ?? null,
            totalOrders: 0,
            totalOrderValue: 0,
            statuses: Object.fromEntries(
              statuses.map((status) => [status, { count: 0, value: 0 }]),
            ) as Partial<StatusTotals>,
          },
        ]),
      );

      for (const group of groupsByPeriod.get(period) ?? []) {
        const count = group._count._all;
        const value = Number(group._sum.totalAmount ?? 0);
        const totalStatus = statusTotals[group.status]!;
        total.totalOrders += count;
        total.totalOrderValue += value;
        totalStatus.count += count;
        totalStatus.value += value;

        const territory = customerTerritories.get(group.userId);
        if (!territory) continue;
        for (const tsr of tsrsByTerritory.get(territory) ?? []) {
          const tsrTotal = tsrTotals.get(tsr.id)!;
          const tsrStatus = tsrTotal.statuses[group.status]!;
          tsrTotal.totalOrders += count;
          tsrTotal.totalOrderValue += value;
          tsrStatus.count += count;
          tsrStatus.value += value;
        }
      }

      const tsrBreakdown = [...tsrTotals.values()].map(
        ({ statuses: _statuses, ...tsr }) => tsr,
      );
      const rank = (metric: "totalOrders" | "totalOrderValue") =>
        tsrBreakdown.reduce<TsrRanking | null>(
          (best, tsr) =>
            tsr.totalOrders === 0 ||
            (best && best[metric] >= tsr[metric])
              ? best
              : tsr,
          null,
        );

      return {
        ...total,
        ...statusTotals,
        tsrs: tsrBreakdown,
        bestTsrByOrderCount: rank("totalOrders"),
        bestTsrByOrderValue: rank("totalOrderValue"),
      };
    };

    return Object.fromEntries(
      Object.entries(periods).map(([period, definition]) => [
        period,
        buildPeriodSummary(period, definition.statuses),
      ]),
    );
  }

  static async getBestPerformance() {
    const summary = await this.getAllSummary();
    if (!summary) {
      throw new Error("Unable to calculate TSR best performance");
    }

    return Object.fromEntries(
      Object.entries(summary).map(([period, data]) => [
        period,
        {
          bestTsrByOrderCount: data.bestTsrByOrderCount,
          bestTsrByOrderValue: data.bestTsrByOrderValue,
        },
      ]),
    );
  }

  static async getSummary() {
    const statuses = await getStatusTotals();
    return summarizeTotals(statuses);
  }

  static async getTsrs() {
    const tsrs = await prisma.user.findMany({
      where: { role: "TSR" },
      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        fullAddress: true,
        divisionId: true,
        districtId: true,
        upazilaId: true,
        division: { select: { id: true, name: true, bnName: true } },
        district: { select: { id: true, name: true, bnName: true } },
        upazila: { select: { id: true, name: true, bnName: true } },
      },
      orderBy: { name: "asc" },
    });

    const territories = new Map<string, Territory>();
    for (const tsr of tsrs) {
      if (tsr.divisionId && tsr.districtId && tsr.upazilaId) {
        const territory = {
          divisionId: tsr.divisionId,
          districtId: tsr.districtId,
          upazilaId: tsr.upazilaId,
        };
        territories.set(territoryKey(territory), territory);
      }
    }

    const totalsByTerritory = new Map(
      await Promise.all(
        [...territories.entries()].map(
          async ([key, territory]) =>
            [
              key,
              await getStatusTotals(buildTerritoryWhere(territory)),
            ] as const,
        ),
      ),
    );

    return tsrs.map((tsr) => {
      const territory =
        tsr.divisionId && tsr.districtId && tsr.upazilaId
          ? {
              divisionId: tsr.divisionId,
              districtId: tsr.districtId,
              upazilaId: tsr.upazilaId,
            }
          : undefined;
      const stats = territory
        ? (totalsByTerritory.get(territoryKey(territory)) ?? zeroSalesTotals())
        : zeroSalesTotals();

      return {
        id: tsr.id,
        name: tsr.name,
        email: tsr.email,
        phone_number: tsr.phone_number,
        fullAddress: tsr.fullAddress,
        divisionId: tsr.divisionId,
        districtId: tsr.districtId,
        upazilaId: tsr.upazilaId,
        division: tsr.division,
        district: tsr.district,
        upazila: tsr.upazila,
        ...summarizeTotals(stats),
      };
    });
  }

  static async getTsrDetail(tsrId: string) {
    const tsr = await prisma.user.findFirst({
      where: { id: tsrId, role: "TSR" },
      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        fullAddress: true,
        divisionId: true,
        districtId: true,
        upazilaId: true,
        division: { select: { id: true, name: true, bnName: true } },
        district: { select: { id: true, name: true, bnName: true } },
        upazila: { select: { id: true, name: true, bnName: true } },
      },
    });

    if (!tsr) return null;

    const hasTerritory = !!(tsr.divisionId && tsr.districtId && tsr.upazilaId);
    const where = hasTerritory
      ? buildTerritoryWhere({
          divisionId: tsr.divisionId!,
          districtId: tsr.districtId!,
          upazilaId: tsr.upazilaId!,
        })
      : { id: { in: [] } };

    const [statuses, territoryOrders, territoryOrderCount] = await Promise.all([
      getStatusTotals(where),
      prisma.order.findMany({
        where,
        include: getOrderInclude(),
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      tsr: {
        id: tsr.id,
        name: tsr.name,
        email: tsr.email,
        phone_number: tsr.phone_number,
        fullAddress: tsr.fullAddress,
        divisionId: tsr.divisionId,
        districtId: tsr.districtId,
        upazilaId: tsr.upazilaId,
        division: tsr.division,
        district: tsr.district,
        upazila: tsr.upazila,
      },
      ...summarizeTotals(statuses),
      territoryOrders,
      territoryOrdersPagination: {
        page: 1,
        limit: 20,
        total: territoryOrderCount,
        totalPages: Math.ceil(territoryOrderCount / 20),
      },
    };
  }

  static async getTsrOrders(tsrId: string, filters: AdminTsrSalesOrderFilters) {
    const tsr = await prisma.user.findFirst({
      where: { id: tsrId, role: "TSR" },
      select: { divisionId: true, districtId: true, upazilaId: true },
    });
    if (!tsr) return null;

    const hasTerritory = !!(tsr.divisionId && tsr.districtId && tsr.upazilaId);
    const and: Prisma.OrderWhereInput[] = [
      hasTerritory
        ? buildTerritoryWhere({
            divisionId: tsr.divisionId!,
            districtId: tsr.districtId!,
            upazilaId: tsr.upazilaId!,
          })
        : { id: { in: [] } },
    ];

    if (filters.status) and.push({ status: filters.status });
    if (filters.startDate || filters.endDate) {
      and.push({
        createdAt: {
          ...(filters.startDate ? { gte: filters.startDate } : {}),
          ...(filters.endDate ? { lte: filters.endDate } : {}),
        },
      });
    }
    if (filters.search) {
      and.push({
        OR: [
          { id: { contains: filters.search, mode: "insensitive" } },
          {
            user: {
              is: { name: { contains: filters.search, mode: "insensitive" } },
            },
          },
          {
            user: {
              is: {
                pharmacy_name: {
                  contains: filters.search,
                  mode: "insensitive",
                },
              },
            },
          },
          {
            user: {
              is: {
                phone_number: { contains: filters.search, mode: "insensitive" },
              },
            },
          },
        ],
      });
    }

    const where: Prisma.OrderWhereInput = { AND: and };
    const skip = (filters.page - 1) * filters.limit;
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: getOrderInclude(),
        orderBy: { createdAt: "desc" },
        skip,
        take: filters.limit,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }
}
