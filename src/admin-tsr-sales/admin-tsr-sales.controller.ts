import { Response } from "express";
import { AuthRequest } from "../types";
import { AdminTsrSalesService } from "./admin-tsr-sales.service";
import {
  isValidTsrId,
  validateAdminTsrSalesOrderFilters,
} from "./admin-tsr-sales.validation";

export class AdminTsrSalesController {
  static async getSummary(_req: AuthRequest, res: Response) {
    try {
      const data = await AdminTsrSalesService.getSummary();
      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("Get admin TSR sales summary error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch TSR sales summary",
      });
    }
  }

  static async getTsrs(_req: AuthRequest, res: Response) {
    try {
      const data = await AdminTsrSalesService.getTsrs();
      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("Get admin TSR sales list error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch TSR sales",
      });
    }
  }

  static async getTsrDetail(req: AuthRequest, res: Response) {
    if (!isValidTsrId(req.params.tsrId)) {
      return res.status(400).json({ success: false, error: "Invalid TSR id" });
    }

    try {
      const data = await AdminTsrSalesService.getTsrDetail(req.params.tsrId);
      if (!data) {
        return res.status(404).json({ success: false, error: "TSR not found" });
      }
      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("Get admin TSR sales detail error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch TSR sales detail",
      });
    }
  }

  static async getTsrOrders(req: AuthRequest, res: Response) {
    if (!isValidTsrId(req.params.tsrId)) {
      return res.status(400).json({ success: false, error: "Invalid TSR id" });
    }

    const validation = validateAdminTsrSalesOrderFilters(req.query);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    try {
      const data = await AdminTsrSalesService.getTsrOrders(
        req.params.tsrId,
        validation.filters,
      );
      if (!data) {
        return res.status(404).json({ success: false, error: "TSR not found" });
      }
      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("Get admin TSR orders error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch TSR orders",
      });
    }
  }
}
