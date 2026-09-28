/** "Send a test notification" to the signed-in user's own devices. */
import { sendTestPushAction } from "@/app/actions/push";
import { ActionForm, SubmitButton } from "./form";

export function TestPushButton() {
  return (
    <ActionForm action={sendTestPushAction} className="space-y-2">
      <SubmitButton small variant="secondary" pendingText="Sending…">
        Send a test notification
      </SubmitButton>
    </ActionForm>
  );
}
