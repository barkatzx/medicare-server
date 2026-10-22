import { NextFunction, Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { CareerError, CareerService } from "./career.service";
import { CareerJobStatus } from "@prisma/client";

type Handler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

const handle =
  (handler: Handler) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof CareerError) {
        return res
          .status(error.statusCode)
          .json({ success: false, error: error.message });
      }
      console.error("[Career] Request failed:", error);
      return res
        .status(500)
        .json({
          success: false,
          error: "Unable to complete the career request",
        });
    }
  };

export class CareerController {
  static listPublicJobs = handle(async (req, res) => {
    const result = await CareerService.listPublicJobs(req.query);
    res.status(200).json({
      success: true,
      message: "Jobs retrieved successfully",
      data: result.jobs,
      pagination: result.pagination,
    });
  });

  static getPublicJob = handle(async (req, res) => {
    const job = await CareerService.getPublicJob(req.params.slug);
    res
      .status(200)
      .json({
        success: true,
        message: "Job retrieved successfully",
        data: job,
      });
  });

  static apply = handle(async (req, res) => {
    const result = await CareerService.apply(
      req.params.jobId,
      req.body,
      req.file,
    );
    res.status(201).json({
      success: true,
      message: "Your application has been submitted successfully.",
      data: { applicationId: result.id, status: result.status },
    });
  });

  static createJob = handle(async (req, res) => {
    const authRequest = req as AuthRequest;
    const job = await CareerService.createJob(req.body, authRequest.user!.id);
    res
      .status(201)
      .json({ success: true, message: "Job created successfully", data: job });
  });

  static listAdminJobs = handle(async (req, res) => {
    const result = await CareerService.listAdminJobs(req.query);
    res.status(200).json({
      success: true,
      message: "Jobs retrieved successfully",
      data: result.jobs,
      pagination: result.pagination,
    });
  });

  static getAdminJob = handle(async (req, res) => {
    const job = await CareerService.getAdminJob(req.params.id);
    res
      .status(200)
      .json({
        success: true,
        message: "Job retrieved successfully",
        data: job,
      });
  });

  static updateJob = handle(async (req, res) => {
    const job = await CareerService.updateJob(req.params.id, req.body);
    res
      .status(200)
      .json({ success: true, message: "Job updated successfully", data: job });
  });

  static publishJob = handle(async (req, res) => {
    const job = await CareerService.transitionJob(
      req.params.id,
      CareerJobStatus.PUBLISHED,
    );
    res
      .status(200)
      .json({
        success: true,
        message: "Job published successfully",
        data: job,
      });
  });

  static closeJob = handle(async (req, res) => {
    const job = await CareerService.transitionJob(
      req.params.id,
      CareerJobStatus.CLOSED,
    );
    res
      .status(200)
      .json({ success: true, message: "Job closed successfully", data: job });
  });

  static archiveJob = handle(async (req, res) => {
    const job = await CareerService.transitionJob(
      req.params.id,
      CareerJobStatus.ARCHIVED,
    );
    res
      .status(200)
      .json({ success: true, message: "Job archived successfully", data: job });
  });

  static listApplications = handle(async (req, res) => {
    const result = await CareerService.listApplications(req.query);
    res.status(200).json({
      success: true,
      message: "Applications retrieved successfully",
      data: result.applications,
      pagination: result.pagination,
    });
  });

  static getApplication = handle(async (req, res) => {
    const application = await CareerService.getApplication(req.params.id);
    res.status(200).json({
      success: true,
      message: "Application retrieved successfully",
      data: application,
    });
  });

  static getResumeAccess = handle(async (req, res) => {
    const resume = await CareerService.getResumeAccess(req.params.id);
    res.status(200).json({
      success: true,
      message: "Temporary resume access created successfully",
      data: resume,
    });
  });

  static updateApplicationStatus = handle(async (req, res) => {
    const authRequest = req as AuthRequest;
    const application = await CareerService.updateApplicationStatus(
      req.params.id,
      req.body.status,
      authRequest.user!.id,
    );
    res.status(200).json({
      success: true,
      message: "Application status updated successfully",
      data: application,
    });
  });

  static updateApplicationNotes = handle(async (req, res) => {
    const application = await CareerService.updateApplicationNotes(
      req.params.id,
      req.body.adminNotes,
    );
    res.status(200).json({
      success: true,
      message: "Administrative notes updated successfully",
      data: application,
    });
  });
}
