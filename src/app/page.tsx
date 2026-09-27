import { redirect } from "next/navigation";
import { homePathFor } from "@/domain/permissions";
import { getSessionUser } from "@/lib/auth/session";

export default async function Root() {
  const user = await getSessionUser();
  redirect(user ? homePathFor(user.role) : "/login");
}
