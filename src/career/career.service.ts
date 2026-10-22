import { CareerJobStatus, Prisma } from "@prisma/client";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import path from "path";
import { prisma } from "../config/supabase";
import {
  CAREER_PAGE_SIZE_DEFAULT,
  CAREER_PAGE_SIZE_MAX,
  RESUME_BUCKET,
  RESUME_MAX_SIZE_BYTES,
  CareerJobInput,
  careerApplicationStatuses,
  careerEmploymentTypes,
  careerJobStatuses,
  careerWorkplaceTypes,
} from "./career.types";

export class CareerError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "CareerError";
  }
}

type QueryValues = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertUuid = (id: string, message: string) => {
  if (!UUID_PATTERN.test(id)) throw new CareerError(message, 404);
};
type PublishableJob = Pick<
  CareerJobInput,
  | "title"
  | "slug"
  | "department"
  | "location"
  | "shortDescription"
  | "description"
  | "applicationDeadline"
>;

const asText = (value: unknown, field: string, required = false) => {
  if (value == null && !required) return null;
  if (typeof value !== "string") {
    throw new CareerError(`${field} must be a string`, 400);
  }
  const trimmed = value.trim();
  if (required && !trimmed) throw new CareerError(`${field} is required`, 400);
  const maxLengths: Record<string, number> = {
    title: 160,
    slug: 180,
    department: 120,
    location: 200,
    shortDescription: 500,
    description: 20000,
    responsibilities: 12000,
    requirements: 12000,
    qualifications: 12000,
    salaryCurrency: 8,
    fullName: 160,
    email: 254,
    phone: 32,
    currentLocation: 200,
    education: 1000,
    currentCompany: 160,
    portfolioUrl: 2048,
    linkedinUrl: 2048,
    coverLetter: 10000,
    adminNotes: 10000,
    search: 200,
    jobId: 180,
  };
  if (trimmed.length > (maxLengths[field] ?? 10000)) {
    throw new CareerError(`${field} exceeds the maximum length`, 400);
  }
  return trimmed || null;
};

const asEnum = <T extends string>(
  value: unknown,
  field: string,
  values: readonly T[],
): T => {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new CareerError(`${field} is invalid`, 400);
  }
  return value as T;
};

const asOptionalMoney = (value: unknown, field: string) => {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new CareerError(`${field} must be a non-negative number`, 400);
  }
  return amount;
};

const asDeadline = (value: unknown) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new CareerError("applicationDeadline must be a valid date", 400);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CareerError("applicationDeadline must be a valid date", 400);
  }
  return date;
};

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const parsePage = (value: unknown, fallback: number) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CareerError("Pagination values must be positive integers", 400);
  }
  return parsed;
};

const pagination = (query: QueryValues) => {
  const page = parsePage(query.page, 1);
  const limit = Math.min(
    parsePage(query.limit, CAREER_PAGE_SIZE_DEFAULT),
    CAREER_PAGE_SIZE_MAX,
  );
  return { page, limit, skip: (page - 1) * limit };
};

function toJobData(input: QueryValues): CareerJobInput;
function toJobData(
  input: QueryValues,
  partial: true,
): Prisma.CareerJobUpdateInput;
function toJobData(
  input: QueryValues,
  partial = false,
): CareerJobInput | Prisma.CareerJobUpdateInput {
  const result: QueryValues = {};
  const textFields = [
    "title",
    "slug",
    "department",
    "location",
    "shortDescription",
    "description",
    "responsibilities",
    "requirements",
    "qualifications",
    "salaryCurrency",
  ] as const;
  for (const field of textFields) {
    if (partial && !(field in input)) continue;
    const value = asText(
      input[field],
      field,
      [
        "title",
        "slug",
        "department",
        "location",
        "shortDescription",
        "description",
      ].includes(field),
    );
    if (value !== null || field in input) result[field] = value;
  }
  if (!partial || "employmentType" in input) {
    result.employmentType = asEnum(
      input.employmentType,
      "employmentType",
      careerEmploymentTypes,
    );
  }
  if (!partial || "workplaceType" in input) {
    result.workplaceType = asEnum(
      input.workplaceType,
      "workplaceType",
      careerWorkplaceTypes,
    );
  }
  for (const field of ["salaryMin", "salaryMax"] as const) {
    if (!partial || field in input)
      result[field] = asOptionalMoney(input[field], field);
  }
  if (!partial || "applicationDeadline" in input) {
    result.applicationDeadline = asDeadline(input.applicationDeadline);
  }
  if (partial && "status" in input) {
    result.status = asEnum(input.status, "status", careerJobStatuses);
  }
  const normalizedSlug =
    typeof result.slug === "string" ? normalizeSlug(result.slug) : undefined;
  if (normalizedSlug !== undefined) {
    if (!normalizedSlug) throw new CareerError("slug is invalid", 400);
    result.slug = normalizedSlug;
  }
  if (
    result.salaryMin != null &&
    result.salaryMax != null &&
    Number(result.salaryMin) > Number(result.salaryMax)
  ) {
    throw new CareerError("salaryMin cannot exceed salaryMax", 400);
  }
  if (partial) return result as Prisma.CareerJobUpdateInput;
  if (!isCareerJobInput(result)) {
    throw new CareerError("Required job fields are missing", 400);
  }
  return result;
}

const isCareerJobInput = (
  value: QueryValues,
): value is QueryValues & CareerJobInput =>
  typeof value.title === "string" &&
  typeof value.slug === "string" &&
  typeof value.department === "string" &&
  careerEmploymentTypes.some((item) => item === value.employmentType) &&
  careerWorkplaceTypes.some((item) => item === value.workplaceType) &&
  typeof value.location === "string" &&
  typeof value.shortDescription === "string" &&
  typeof value.description === "string" &&
  (value.salaryMin === null || typeof value.salaryMin === "number") &&
  (value.salaryMax === null || typeof value.salaryMax === "number") &&
  (value.applicationDeadline === null ||
    value.applicationDeadline instanceof Date);

const getStorageClient = (): SupabaseClient => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new CareerError("Resume storage is not configured", 503);
  }
  return createClient(url, serviceKey);
};

const createResumeAccess = async (
  storagePath: string,
  originalName: string,
) => {
  const { error, data } = await getStorageClient()
    .storage.from(RESUME_BUCKET)
    .createSignedUrl(storagePath, 300, { download: originalName });
  if (error) {
    console.error("[Career] Resume signed URL failed:", error.message);
    throw new CareerError("Unable to access this resume right now", 503);
  }
  return { resumeUrl: data.signedUrl, resumeUrlExpiresIn: 300 };
};

const getPublicJobWhere = (): Prisma.CareerJobWhereInput => ({
  status: CareerJobStatus.PUBLISHED,
  OR: [
    { applicationDeadline: null },
    { applicationDeadline: { gte: new Date() } },
  ],
});

const parseApplication = (body: QueryValues) => {
  const fullName = asText(body.fullName, "fullName", true)!;
  const email = asText(body.email, "email", true)!.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CareerError("A valid email address is required", 400);
  }
  const phone = asText(body.phone, "phone", true)!;
  if (!/^[+\d][\d\s().-]{6,24}$/.test(phone)) {
    throw new CareerError("A valid phone number is required", 400);
  }
  const experienceYears =
    body.experienceYears == null || body.experienceYears === ""
      ? null
      : Number(body.experienceYears);
  if (
    experienceYears !== null &&
    (!Number.isInteger(experienceYears) ||
      experienceYears < 0 ||
      experienceYears > 80)
  ) {
    throw new CareerError(
      "experienceYears must be an integer between 0 and 80",
      400,
    );
  }
  const optionalUrl = (field: "portfolioUrl" | "linkedinUrl") => {
    const value = asText(body[field], field);
    if (value === null) return null;
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new CareerError(`${field} must be a valid HTTP or HTTPS URL`, 400);
    }
    return value;
  };
  return {
    fullName,
    email,
    phone,
    currentLocation: asText(body.currentLocation, "currentLocation"),
    education: asText(body.education, "education"),
    experienceYears,
    currentCompany: asText(body.currentCompany, "currentCompany"),
    portfolioUrl: optionalUrl("portfolioUrl"),
    linkedinUrl: optionalUrl("linkedinUrl"),
    coverLetter: asText(body.coverLetter, "coverLetter"),
  };
};

const assertPublishedAndOpen = async (jobId: string) => {
  const job = await prisma.careerJob.findFirst({
    where: { id: jobId, ...getPublicJobWhere() },
    select: { id: true },
  });
  if (!job) {
    throw new CareerError(
      "This job is unavailable or no longer accepting applications",
      404,
    );
  }
};

const assertUniqueSlug = async (slug: string, exceptId?: string) => {
  const existing = await prisma.careerJob.findFirst({
    where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (existing)
    throw new CareerError("A job with this slug already exists", 409);
};

const assertPublishable = (job: PublishableJob) => {
  for (const field of [
    "title",
    "slug",
    "department",
    "location",
    "shortDescription",
    "description",
  ] as const) {
    if (!job[field]) {
      throw new CareerError(`Cannot publish without ${field}`, 400);
    }
  }
  if (
    job.applicationDeadline &&
    new Date(job.applicationDeadline).getTime() < Date.now()
  ) {
    throw new CareerError(
      "Cannot publish a job with a past application deadline",
      400,
    );
  }
};

const handlePrismaError = (error: unknown): never => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new CareerError(
      "A job with this slug or an application for this job already exists",
      409,
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    throw new CareerError("The requested career record was not found", 404);
  }
  throw error;
};

export class CareerService {
  static async listPublicJobs(query: QueryValues) {
    const { page, limit, skip } = pagination(query);
    const department = asText(query.department, "department");
    const employmentType =
      query.employmentType == null
        ? undefined
        : asEnum(query.employmentType, "employmentType", careerEmploymentTypes);
    const search = asText(query.search, "search");
    const where: Prisma.CareerJobWhereInput = {
      status: CareerJobStatus.PUBLISHED,
      AND: [
        {
          OR: [
            { applicationDeadline: null },
            { applicationDeadline: { gte: new Date() } },
          ],
        },
        ...(search
          ? [
              {
                OR: [
                  { title: { contains: search, mode: "insensitive" as const } },
                  {
                    department: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
      ...(department
        ? { department: { equals: department, mode: "insensitive" } }
        : {}),
      ...(employmentType ? { employmentType } : {}),
    };
    const [jobs, total] = await Promise.all([
      prisma.careerJob.findMany({
        where,
        select: {
          id: true,
          title: true,
          slug: true,
          department: true,
          employmentType: true,
          workplaceType: true,
          location: true,
          shortDescription: true,
          applicationDeadline: true,
          publishedAt: true,
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
      prisma.careerJob.count({ where }),
    ]);
    return {
      jobs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  static async getPublicJob(slug: string) {
    const job = await prisma.careerJob.findFirst({
      where: { slug, ...getPublicJobWhere() },
      select: {
        id: true,
        title: true,
        slug: true,
        department: true,
        employmentType: true,
        workplaceType: true,
        location: true,
        shortDescription: true,
        description: true,
        responsibilities: true,
        requirements: true,
        qualifications: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        applicationDeadline: true,
        publishedAt: true,
      },
    });
    if (!job) throw new CareerError("Job not found", 404);
    return job;
  }

  static async apply(
    jobId: string,
    body: QueryValues,
    file: Express.Multer.File | undefined,
  ) {
    assertUuid(
      jobId,
      "This job is unavailable or no longer accepting applications",
    );
    if (!file) throw new CareerError("Resume/CV is required", 400);
    const application = parseApplication(body);
    await assertPublishedAndOpen(jobId);

    const duplicate = await prisma.careerApplication.findFirst({
      where: {
        jobId,
        email: { equals: application.email, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new CareerError(
        "An application for this job has already been submitted with this email",
        409,
      );
    }

    const extension = path.extname(file.originalname).toLowerCase();
    const extensionMimeTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    if (extensionMimeTypes[extension] !== file.mimetype) {
      throw new CareerError("Resume must be a PDF, DOC, or DOCX file", 400);
    }
    const signatureMatches =
      (extension === ".pdf" &&
        file.buffer.subarray(0, 5).toString() === "%PDF-") ||
      (extension === ".doc" &&
        file.buffer
          .subarray(0, 8)
          .equals(
            Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
          )) ||
      (extension === ".docx" &&
        file.buffer.subarray(0, 2).equals(Buffer.from([0x50, 0x4b])));
    if (!signatureMatches) {
      throw new CareerError(
        "The uploaded resume does not match its file type",
        400,
      );
    }

    const storagePath = `${jobId}/${randomUUID()}${extension}`;
    const storage = getStorageClient();
    const doUpload = () =>
      storage.storage.from(RESUME_BUCKET).upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    let { error: uploadError } = await doUpload();
    if (uploadError && /bucket not found/i.test(uploadError.message)) {
      // Create the private bucket on first use, then retry once.
      const { error: bucketError } = await storage.storage.createBucket(
        RESUME_BUCKET,
        { public: false, fileSizeLimit: RESUME_MAX_SIZE_BYTES },
      );
      if (bucketError && !/already exists/i.test(bucketError.message)) {
        console.error("[Career] Bucket creation failed:", bucketError.message);
      } else {
        ({ error: uploadError } = await doUpload());
      }
    }
    if (uploadError) {
      console.error("[Career] Resume upload failed:", uploadError.message);
      throw new CareerError("Unable to store resume; please try again", 503);
    }

    try {
      const created = await prisma.careerApplication.create({
        data: {
          ...application,
          jobId,
          resumeStoragePath: storagePath,
          resumeOriginalName: path.basename(file.originalname).slice(0, 255),
          resumeMimeType: file.mimetype,
          resumeSizeBytes: file.size,
        },
        select: { id: true, status: true },
      });
      return created;
    } catch (error) {
      const { error: cleanupError } = await storage.storage
        .from(RESUME_BUCKET)
        .remove([storagePath]);
      if (cleanupError) {
        console.error(
          "[Career] Failed to clean up orphaned resume:",
          cleanupError.message,
        );
      }
      return handlePrismaError(error);
    }
  }

  static async createJob(body: QueryValues, userId: string) {
    const data = toJobData(body);
    if (body.status != null) {
      data.status = asEnum(body.status, "status", careerJobStatuses);
    }
    if (data.status === CareerJobStatus.PUBLISHED) assertPublishable(data);
    await assertUniqueSlug(data.slug);
    try {
      return await prisma.careerJob.create({
        data: {
          ...data,
          status: data.status ?? CareerJobStatus.DRAFT,
          publishedAt:
            data.status === CareerJobStatus.PUBLISHED ? new Date() : null,
          createdById: userId,
        },
      });
    } catch (error) {
      return handlePrismaError(error);
    }
  }

  static async listAdminJobs(query: QueryValues) {
    const { page, limit, skip } = pagination(query);
    const status =
      query.status == null
        ? undefined
        : asEnum(query.status, "status", careerJobStatuses);
    const department = asText(query.department, "department");
    const search = asText(query.search, "search");
    const where: Prisma.CareerJobWhereInput = {
      ...(status ? { status } : {}),
      ...(department
        ? { department: { contains: department, mode: "insensitive" } }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { department: { contains: search, mode: "insensitive" } },
              { location: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [jobs, total] = await Promise.all([
      prisma.careerJob.findMany({
        where,
        include: { _count: { select: { applications: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.careerJob.count({ where }),
    ]);
    return {
      jobs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  static async getAdminJob(id: string) {
    assertUuid(id, "Job not found");
    const job = await prisma.careerJob.findUnique({
      where: { id },
      include: { _count: { select: { applications: true } } },
    });
    if (!job) throw new CareerError("Job not found", 404);
    return job;
  }

  static async updateJob(id: string, body: QueryValues) {
    assertUuid(id, "Job not found");
    const data = toJobData(body, true);
    if (Object.keys(data).length === 0) {
      throw new CareerError("At least one job field must be provided", 400);
    }
    const existing = await prisma.careerJob.findUnique({ where: { id } });
    if (!existing) throw new CareerError("Job not found", 404);
    const salaryMin =
      data.salaryMin === undefined ? existing.salaryMin : data.salaryMin;
    const salaryMax =
      data.salaryMax === undefined ? existing.salaryMax : data.salaryMax;
    if (
      salaryMin !== null &&
      salaryMax !== null &&
      Number(salaryMin) > Number(salaryMax)
    ) {
      throw new CareerError("salaryMin cannot exceed salaryMax", 400);
    }
    if (typeof data.slug === "string") await assertUniqueSlug(data.slug, id);
    if (
      data.status === CareerJobStatus.PUBLISHED &&
      existing.status !== CareerJobStatus.PUBLISHED
    ) {
      const candidate: PublishableJob = {
        title: typeof data.title === "string" ? data.title : existing.title,
        slug: typeof data.slug === "string" ? data.slug : existing.slug,
        department:
          typeof data.department === "string"
            ? data.department
            : existing.department,
        location:
          typeof data.location === "string" ? data.location : existing.location,
        shortDescription:
          typeof data.shortDescription === "string"
            ? data.shortDescription
            : existing.shortDescription,
        description:
          typeof data.description === "string"
            ? data.description
            : existing.description,
        applicationDeadline:
          data.applicationDeadline === null
            ? null
            : data.applicationDeadline instanceof Date
              ? data.applicationDeadline
              : existing.applicationDeadline,
      };
      assertPublishable(candidate);
      data.publishedAt = new Date();
    }
    try {
      return await prisma.careerJob.update({ where: { id }, data });
    } catch (error) {
      return handlePrismaError(error);
    }
  }

  static async transitionJob(id: string, status: CareerJobStatus) {
    assertUuid(id, "Job not found");
    const job = await prisma.careerJob.findUnique({ where: { id } });
    if (!job) throw new CareerError("Job not found", 404);
    if (status === CareerJobStatus.PUBLISHED) {
      assertPublishable(job);
      if (job.status === CareerJobStatus.ARCHIVED) {
        throw new CareerError("Archived jobs cannot be published", 409);
      }
    }
    try {
      return await prisma.careerJob.update({
        where: { id },
        data: {
          status,
          ...(status === CareerJobStatus.PUBLISHED && !job.publishedAt
            ? { publishedAt: new Date() }
            : {}),
        },
      });
    } catch (error) {
      handlePrismaError(error);
    }
  }

  static async listApplications(query: QueryValues) {
    const { page, limit, skip } = pagination(query);
    const status =
      query.status == null
        ? undefined
        : asEnum(query.status, "status", careerApplicationStatuses);
    const jobId = asText(query.jobId, "jobId");
    if (jobId) assertUuid(jobId, "jobId is invalid");
    const search = asText(query.search, "search");
    const dateFrom = asDeadline(query.dateFrom);
    const dateTo = asDeadline(query.dateTo);
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new CareerError("dateFrom cannot be after dateTo", 400);
    }
    const where: Prisma.CareerApplicationWhereInput = {
      ...(status ? { status } : {}),
      ...(jobId ? { jobId } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };
    const [applications, total] = await Promise.all([
      prisma.careerApplication.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          experienceYears: true,
          status: true,
          createdAt: true,
          job: { select: { id: true, title: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.careerApplication.count({ where }),
    ]);
    return {
      applications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  static async getApplication(id: string) {
    assertUuid(id, "Application not found");
    const application = await prisma.careerApplication.findUnique({
      where: { id },
      include: {
        job: {
          select: { id: true, title: true, slug: true, department: true },
        },
      },
    });
    if (!application) throw new CareerError("Application not found", 404);
    const { resumeStoragePath, ...privateApplication } = application;
    return privateApplication;
  }

  static async getResumeAccess(id: string) {
    assertUuid(id, "Application not found");
    const application = await prisma.careerApplication.findUnique({
      where: { id },
      select: { resumeStoragePath: true, resumeOriginalName: true },
    });
    if (!application) throw new CareerError("Application not found", 404);
    return createResumeAccess(
      application.resumeStoragePath,
      application.resumeOriginalName,
    );
  }

  static async updateApplicationStatus(
    id: string,
    status: unknown,
    reviewerId: string,
  ) {
    assertUuid(id, "Application not found");
    const validStatus = asEnum(status, "status", careerApplicationStatuses);
    try {
      return await prisma.careerApplication.update({
        where: { id },
        data: {
          status: validStatus,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
        },
        select: {
          id: true,
          status: true,
          reviewedById: true,
          reviewedAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      handlePrismaError(error);
    }
  }

  static async updateApplicationNotes(id: string, notes: unknown) {
    assertUuid(id, "Application not found");
    if (notes === undefined) {
      throw new CareerError("adminNotes is required", 400);
    }
    const adminNotes = asText(notes, "adminNotes");
    try {
      return await prisma.careerApplication.update({
        where: { id },
        data: { adminNotes },
        select: { id: true, adminNotes: true, updatedAt: true },
      });
    } catch (error) {
      handlePrismaError(error);
    }
  }
}
