/** "Change password" form for any signed-in user (owner, staff, resident). */
import { changePasswordAction } from "@/app/actions/auth";
import { PASSWORD_MIN_LENGTH } from "@/lib/security/crypto";
import { ActionForm, Input, SubmitButton } from "./form";

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-4">
      <Input name="currentPassword" type="password" label="Current password" autoComplete="current-password" required />
      <Input
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`}
        required
      />
      <Input name="confirm" type="password" label="Type it again" autoComplete="new-password" required />
      <SubmitButton pendingText="Saving…">Change password</SubmitButton>
    </ActionForm>
  );
}
