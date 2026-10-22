import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import path from "path";
import {
  authenticateToken,
  authorizeAdmin,
} from "../middleware/auth.middleware";
import { rateLimit } from "../middleware/rate-limit.middleware";
import { CareerController } from "./career.controller";
import { RESUME_MAX_SIZE_BYTES } from "./career.types";

const router = Router();

const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RESUME_MAX_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowed: Record<string, string> = {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    if (allowed[extension] === file.mimetype) return callback(null, true);
    return callback(new Error("Resume must be a PDF, DOC, or DOCX file"));
  },
}).single("resume");

const handleResumeUpload = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  resumeUpload(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "Resume must be 5 MB or smaller"
            : "Resume upload is invalid",
      });
    }
    if (error instanceof Error) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next();
  });
};

router.get("/jobs", CareerController.listPublicJobs);
router.get("/jobs/:slug", CareerController.getPublicJob);
router.post(
  "/jobs/:jobId/apply",
  rateLimit(5, 900, "career-applications"),
  handleResumeUpload,
  CareerController.apply,
);

const adminRouter = Router();
adminRouter.use(authenticateToken, authorizeAdmin);
adminRouter.post("/jobs", CareerController.createJob);
adminRouter.get("/jobs", CareerController.listAdminJobs);
adminRouter.get("/jobs/:id", CareerController.getAdminJob);
adminRouter.patch("/jobs/:id", CareerController.updateJob);
adminRouter.patch("/jobs/:id/publish", CareerController.publishJob);
adminRouter.patch("/jobs/:id/close", CareerController.closeJob);
adminRouter.patch("/jobs/:id/archive", CareerController.archiveJob);
adminRouter.get("/applications", CareerController.listApplications);
adminRouter.get("/applications/:id", CareerController.getApplication);
adminRouter.get("/applications/:id/resume", CareerController.getResumeAccess);
adminRouter.patch(
  "/applications/:id/status",
  CareerController.updateApplicationStatus,
);
adminRouter.patch(
  "/applications/:id/notes",
  CareerController.updateApplicationNotes,
);
router.use("/admin", adminRouter);

export default router;
