export const TSR_ALLOWED_STATUSES = [
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type TsrStatus = (typeof TSR_ALLOWED_STATUSES)[number];

export const isValidTSRStatus = (status: unknown): status is TsrStatus =>
  typeof status === "string" &&
  TSR_ALLOWED_STATUSES.includes(status as TsrStatus);

export const ORDER_STATUS_FILTERS = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export const isValidOrderStatusFilter = (
  status: unknown,
): status is (typeof ORDER_STATUS_FILTERS)[number] =>
  typeof status === "string" &&
  ORDER_STATUS_FILTERS.includes(status as (typeof ORDER_STATUS_FILTERS)[number]);
