import { Response } from "express";
import { AuthRequest } from "../types";
import { TsrService } from "./tsr.service";
import { isValidOrderStatusFilter, isValidTSRStatus } from "./tsr.validation";

export class TsrController {
  static async getOrders(req: AuthRequest, res: Response) {
    try {
      const page = Number(req.query.page ?? 1) || 1;
      const limit = Number(req.query.limit ?? 20) || 20;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;

      if (status && !isValidOrderStatusFilter(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid status filter",
        });
      }

      const result = await TsrService.getOrdersForTSR(req.user!.id, {
        page,
        limit,
        status,
        search,
        startDate,
        endDate,
      });

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get TSR orders error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch TSR orders",
      });
    }
  }

  static async getOrderSummary(req: AuthRequest, res: Response) {
    try {
      const result = await TsrService.getOrderSummaryForTSR(req.user!.id);
      return res.status(200).json(result);
    } catch (error) {
      console.error("Get TSR order summary error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch TSR order summary",
      });
    }
  }

  static async getOrderById(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;
      const result = await TsrService.getOrderByIdForTSR(req.user!.id, orderId);

      if (!result.success) {
        return res.status(result.status ?? 404).json({
          success: false,
          error: result.error ?? "Order not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      console.error("Get TSR order by id error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch TSR order",
      });
    }
  }

  static async updateOrderStatus(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;
      const { status } = req.body as { status?: string };

      if (!status || !isValidTSRStatus(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid status",
        });
      }

      const result = await TsrService.updateOrderStatusForTSR(
        req.user!.id,
        orderId,
        status,
      );

      if (!result.success) {
        return res.status(result.status ?? 400).json({
          success: false,
          error: result.error ?? "Failed to update order status",
        });
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Update TSR order status error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to update TSR order status",
      });
    }
  }
}
