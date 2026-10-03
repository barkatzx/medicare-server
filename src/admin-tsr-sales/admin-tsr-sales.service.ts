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
      division: { select: { id: true, name: true } },
      district: { select: { id: true, name: true } },
      upazila: { select: { id: true, name: true } },
    },
  },
});

export class AdminTsrSalesService {
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
        division: { select: { id: true, name: true } },
        district: { select: { id: true, name: true } },
        upazila: { select: { id: true, name: true } },
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
        territory: {
          fullAddress: tsr.fullAddress,
          division: tsr.division,
          district: tsr.district,
          upazila: tsr.upazila,
          divisionId: tsr.divisionId,
          districtId: tsr.districtId,
          upazilaId: tsr.upazilaId,
        },
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
        division: { select: { id: true, name: true } },
        district: { select: { id: true, name: true } },
        upazila: { select: { id: true, name: true } },
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
        territory: {
          fullAddress: tsr.fullAddress,
          division: tsr.division,
          district: tsr.district,
          upazila: tsr.upazila,
          divisionId: tsr.divisionId,
          districtId: tsr.districtId,
          upazilaId: tsr.upazilaId,
        },
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
