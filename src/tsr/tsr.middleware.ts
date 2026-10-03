import { NextFunction, Response } from "express";
import { AuthRequest } from "../types";

export const authorizeTSR = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (req.user?.role !== "TSR") {
    return res.status(403).json({
      success: false,
      error: "TSR access required",
    });
  }

  next();
};
