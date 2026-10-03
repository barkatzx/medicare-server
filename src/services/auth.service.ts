import { compare, hash } from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../config/supabase";
import { LoginInput, RegisterInput, UserPayload } from "../types/index";

export class AuthService {
  private static async hashPassword(password: string): Promise<string> {
    return await hash(password, 10);
  }

  static async register(input: RegisterInput) {
    const { email, phone_number, name, pharmacy_name, password, role } = input;

    if (role === "admin" || role === "TSR") {
      throw new Error("Only customer accounts can be created during self-registration");
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone_number }],
      },
    });

    if (existingUser) {
      throw new Error("User with this email or phone number already exists");
    }

    const hashedPassword = await this.hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        phone_number,
        name,
        pharmacy_name,
        password: hashedPassword,
        role: role || "customer",
        isApproved: false,
      },
      select: {
        id: true,
        email: true,
        phone_number: true,
        name: true,
        pharmacy_name: true,
        role: true,
        isApproved: true,
        createdAt: true,
      },
    });

    await prisma.cart.create({
      data: { userId: user.id },
    });

    return {
      user,
      message: "Registration successful. Please wait for admin approval.",
    };
  }

  // Login With Email or Phone Number
  static async login(input: LoginInput) {
    const { email, phone_number, password } = input;

    // Validate that at least one identifier is provided
    if (!email && !phone_number) {
      throw new Error("Email or phone number is required");
    }

    // Build the where condition dynamically
    const whereCondition: any = {};
    if (email) {
      whereCondition.email = email;
    } else if (phone_number) {
      whereCondition.phone_number = phone_number;
    }

    const user = await prisma.user.findUnique({
      where: whereCondition,
      select: {
        id: true,
        email: true,
        phone_number: true,
        password: true,
        role: true,
        isApproved: true,
        name: true,
        pharmacy_name: true,
      },
    });

    if (!user) {
      throw new Error("Invalid email/phone number or password");
    }

    if (!user.isApproved) {
      throw new Error("Your account is pending approval");
    }

    const isPasswordValid = await compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error("Invalid email/phone number or password");
    }

    const { password: _, ...userWithoutPassword } = user;

    const payload: UserPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      isApproved: user.isApproved,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: "30d",
    });

    return {
      user: userWithoutPassword,
      token,
      message: "Login successful",
    };
  }

  static async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const isPasswordValid = await compare(oldPassword, user.password);
    if (!isPasswordValid) {
      throw new Error("Current password is incorrect");
    }

    const hashedNewPassword = await this.hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword },
    });

    return { message: "Password changed successfully" };
  }

  static async getUserById(userId: string): Promise<UserPayload | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isApproved: true,
      },
    });

    return user;
  }

  static async verifyUser(userId: string): Promise<UserPayload | null> {
    return this.getUserById(userId); // FIX: was duplicated logic
  }
}
