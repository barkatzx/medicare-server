import { NextFunction, Request, Response } from "express";
import { body, validationResult } from "express-validator";

export const validateRegister = [
  body("email").isEmail().normalizeEmail(),
  body("phone_number").isMobilePhone("any"),
  body("password").isLength({ min: 6 }),
  body("name").optional().isString(),
  body("pharmacy_name").optional().isString(),
  body("fullAddress").optional().isString(),
  body("divisionId").optional().isUUID(),
  body("districtId").optional().isUUID(),
  body("upazilaId").optional().isUUID(),
  body("role").optional().isIn(["customer"]),
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];

export const validateLogin = [
  body("email").optional({ checkFalsy: true }).isEmail(),
  body("phone_number")
    .optional({ checkFalsy: true })
    .isMobilePhone("any"),
  body("password").notEmpty(),
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];
