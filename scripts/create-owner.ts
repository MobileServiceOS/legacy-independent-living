/**
 * Create the first owner/admin account (or reset an owner's password).
 *   OWNER_EMAIL=you@example.com OWNER_NAME="Your Name" OWNER_PASSWORD='long-passphrase-1' npm run owner:create
 */
import { prisma } from "../src/lib/db";
import { hashPassword, validatePasswordStrength } from "../src/lib/security/crypto";

async function main() {
  const email = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.OWNER_NAME ?? "").trim();
  const password = process.env.OWNER_PASSWORD ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) throw new Error("Set OWNER_EMAIL and OWNER_NAME");
  const weak = validatePasswordStrength(password);
  if (weak) throw new Error(`OWNER_PASSWORD: ${weak}`);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== "ADMIN") throw new Error(`${email} belongs to a resident account`);
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, role: "ADMIN", status: "ACTIVE", passwordHash },
    update: { name, status: "ACTIVE", passwordHash },
  });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.auditLog.create({ data: { actorEmail: "cli", action: existing ? "owner.password_reset" : "owner.created", entityType: "user", entityId: user.id } });
  console.log(`${existing ? "Updated" : "Created"} owner ${email}. Sign in at /login.`);
}

main()
  .catch((e) => {
    console.error(`✖ ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
