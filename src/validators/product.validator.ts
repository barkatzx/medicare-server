import { NextFunction, Request, Response } from "express";
import { body, validationResult } from "express-validator";

const productFieldValidators = [
  body("distributor")
    .optional({ nullable: true })
    .isString()
    .withMessage("Distributor must be a string"),
  body("tp")
    .optional({ nullable: true })
    .custom((value) => {
      if (typeof value === "string" && value.trim() === "") {
        return true;
      }

      if (typeof value !== "number" && typeof value !== "string") {
        return false;
      }

      const tradePrice = Number(value);
      return (
        Number.isFinite(tradePrice) &&
        tradePrice >= 0 &&
        tradePrice <= 99999999.99
      );
    })
    .withMessage("TP must be a non-negative number with a maximum of 99999999.99"),
];

export const validateProductFields = [
  ...productFieldValidators,
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Invalid product fields",
        details: errors.array(),
      });
    }
    next();
  },
];
