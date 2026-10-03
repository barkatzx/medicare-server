import { OrderStatus } from "@prisma/client";
import { Request } from "express";

export interface AdminTsrSalesOrderFilters {
  page: number;
  limit: number;
  status?: OrderStatus;
  search?: string;
  startDate?: Date;
  endDate?: Date;
}

type ValidationResult =
  | { valid: true; filters: AdminTsrSalesOrderFilters }
  | { valid: false; error: string };

const orderStatuses = Object.values(OrderStatus);

export const isValidTsrId = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export const validateAdminTsrSalesOrderFilters = (
  query: Request["query"],
): ValidationResult => {
  const rawPage = query.page;
  const rawLimit = query.limit;
  const page = rawPage === undefined ? 1 : Number(rawPage);
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);

  if (!Number.isSafeInteger(page) || page < 1) {
    return { valid: false, error: "Page must be a positive integer" };
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { valid: false, error: "Limit must be an integer between 1 and 100" };
  }
  if (page > Math.floor(2_147_483_647 / limit)) {
    return { valid: false, error: "Page is too large" };
  }

  let status: OrderStatus | undefined;
  if (query.status !== undefined) {
    if (typeof query.status !== "string" || !orderStatuses.includes(query.status as OrderStatus)) {
      return { valid: false, error: "Invalid status filter" };
    }
    status = query.status as OrderStatus;
  }

  if (query.search !== undefined && typeof query.search !== "string") {
    return { valid: false, error: "Search must be a string" };
  }

  let startDate: Date | undefined;
  if (query.startDate !== undefined) {
    if (typeof query.startDate !== "string" || Number.isNaN(Date.parse(query.startDate))) {
      return { valid: false, error: "Invalid startDate" };
    }
    startDate = new Date(query.startDate);
  }

  let endDate: Date | undefined;
  if (query.endDate !== undefined) {
    if (typeof query.endDate !== "string" || Number.isNaN(Date.parse(query.endDate))) {
      return { valid: false, error: "Invalid endDate" };
    }
    endDate = new Date(query.endDate);
    endDate.setUTCHours(23, 59, 59, 999);
  }

  if (startDate && endDate && startDate > endDate) {
    return { valid: false, error: "startDate must be before or equal to endDate" };
  }

  return {
    valid: true,
    filters: {
      page,
      limit,
      status,
      search: typeof query.search === "string" ? query.search.trim() : undefined,
      startDate,
      endDate,
    },
  };
};
