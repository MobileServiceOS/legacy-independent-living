/**
 * Change the login email for an existing ADMIN (owner/staff) account, in place —
 * keeps the same user id, password, audit history and sessions-invalidated-on-rename,
 * instead of `owner:create`'s upsert (which would create a *second* account at the
 * new address and orphan the old one).
 *
 *   OLD_OWNER_EMAIL=old@example.com NEW_OWNER_EMAIL=new@example.com npm run owner:change-email
 *
 * If OLD_OWNER_EMAIL is omitted and there is exactly one ADMIN account, it's used
 * automatically.
 */
import { prisma } from "../src/lib/db";

async function main() {
  const newEmail = (process.env.NEW_OWNER_EMAIL ?? "").trim().toLowerCase();
  let oldEmail = (process.env.OLD_OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) throw new Error("Set NEW_OWNER_EMAIL to a valid address");

  if (!oldEmail) {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
    if (admins.length !== 1) {
      throw new Error(
        admins.length === 0
          ? "No ADMIN accounts exist — use owner:create instead."
          : `Multiple ADMIN accounts exist (${admins.map((a) => a.email).join(", ")}); set OLD_OWNER_EMAIL to pick one.`,
      );
    }
    oldEmail = admins[0]!.email;
  }
  if (oldEmail === newEmail) throw new Error("OLD_OWNER_EMAIL and NEW_OWNER_EMAIL are the same");

  const user = await prisma.user.findUnique({ where: { email: oldEmail } });
  if (!user) throw new Error(`No account found for ${oldEmail}`);
  if (user.role !== "ADMIN") throw new Error(`${oldEmail} is not an ADMIN account (role: ${user.role})`);

  const taken = await prisma.user.findUnique({ where: { email: newEmail } });
  if (taken) throw new Error(`${newEmail} is already in use by another account`);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { email: newEmail } }),
    // Renaming the login identity invalidates existing sessions — sign in again at the new address.
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.auditLog.create({
      data: { actorEmail: newEmail, action: "owner.email_changed", entityType: "user", entityId: user.id, metadata: { from: oldEmail, to: newEmail } },
    }),
  ]);

  console.log(`Changed owner login from ${oldEmail} to ${newEmail}. Sign in at /login with the new address (same password).`);
}

main()
  .catch((e) => {
    console.error(`✖ ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
