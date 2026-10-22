import {
  CareerApplicationStatus,
  CareerEmploymentType,
  CareerJobStatus,
  CareerWorkplaceType,
  Prisma,
} from "@prisma/client";

export interface CareerJobInput {
  title: string;
  slug: string;
  department: string;
  employmentType: CareerEmploymentType;
  workplaceType: CareerWorkplaceType;
  location: string;
  shortDescription: string;
  description: string;
  responsibilities?: string | null;
  requirements?: string | null;
  qualifications?: string | null;
  salaryMin?: number | Prisma.Decimal | null;
  salaryMax?: number | Prisma.Decimal | null;
  salaryCurrency?: string | null;
  applicationDeadline?: Date | null;
  status?: CareerJobStatus;
}

export const CAREER_PAGE_SIZE_DEFAULT = 20;
export const CAREER_PAGE_SIZE_MAX = 100;
export const RESUME_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const RESUME_BUCKET = "career-resumes";

export const careerEmploymentTypes = Object.values(CareerEmploymentType);
export const careerWorkplaceTypes = Object.values(CareerWorkplaceType);
export const careerJobStatuses = Object.values(CareerJobStatus);
export const careerApplicationStatuses = Object.values(CareerApplicationStatus);
