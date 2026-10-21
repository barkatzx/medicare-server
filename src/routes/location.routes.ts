import { Request, Response, Router } from "express";
import { prisma } from "../config/supabase";
import {
  authenticateToken,
  authorizeAdmin,
} from "../middleware/auth.middleware";

const router = Router();
const select = { id: true, code: true, name: true, bnName: true };
const orderBy = { name: "asc" as const };

const queryString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

router.use(authenticateToken, authorizeAdmin);

router.get("/divisions", async (_req: Request, res: Response) => {
  try {
    const data = await prisma.division.findMany({ select, orderBy });
    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: "Failed to fetch divisions" });
  }
});

router.get("/districts", async (req: Request, res: Response) => {
  try {
    const divisionId = queryString(req.query.divisionId);
    const data = await prisma.district.findMany({
      where: divisionId ? { divisionId } : undefined,
      select: { ...select, divisionId: true },
      orderBy,
    });
    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: "Failed to fetch districts" });
  }
});

router.get("/upazilas", async (req: Request, res: Response) => {
  try {
    const districtId = queryString(req.query.districtId);
    const data = await prisma.upazila.findMany({
      where: districtId ? { districtId } : undefined,
      select: { ...select, districtId: true },
      orderBy,
    });
    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: "Failed to fetch upazilas" });
  }
});

export default router;
