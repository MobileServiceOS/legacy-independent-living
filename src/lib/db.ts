import { PrismaClient, type Prisma } from "@prisma/client";

const g = globalThis as unknown as { __lilPrisma?: PrismaClient };

export const prisma: PrismaClient =
  g.__lilPrisma ?? new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") g.__lilPrisma = prisma;

export type Tx = Prisma.TransactionClient;
/** Anything that can run queries: the root client or a transaction. */
export type Db = PrismaClient | Tx;
