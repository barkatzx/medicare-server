import { Request } from "express";

export type UserRole = "admin" | "customer" | "TSR";

export interface UserPayload {
  id: string;
  email: string;
  role: UserRole;
  isApproved: boolean;
}

export interface RegisterInput {
  email: string;
  phone_number: string;
  name?: string;
  pharmacy_name?: string;
  password: string;
  role?: UserRole;
}

export interface LoginInput {
  email: string;
  phone_number: string;
  password: string;
}

export interface AuthRequest extends Request {
  user?: UserPayload;
}

// src/types/index.ts
export interface ProductImageInput {
  url: string;
  altText?: string;
}

export interface CreateProductBody {
  name: string;
  description: string;
  price: number;
  discountedPrice?: number;
  discountPercent?: number;
  stock?: number;
  distributor?: string | null;
  tp?: number | null;
  categoryId: string;
  images?: ProductImageInput[];
}

export interface UpdateProductBody {
  name?: string;
  description?: string;
  price?: number;
  discountedPrice?: number;
  discountPercent?: number;
  stock?: number;
  distributor?: string | null;
  tp?: number | null;
  categoryId?: string;
}

export interface ProductResponse {
  id: string;
  name: string;
  description: string;
  price: number;
  discountedPrice: number | null;
  discountPercent: number | null;
  finalPrice: number; // Calculated field
  savings: number; // Calculated field
  stock: number;
  distributor: string | null;
  tp: number | null;
  categoryId: string;
  images: any[];
  category: any;
}
