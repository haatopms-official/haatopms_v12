import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import SuperuserGuests from "@/pages/SuperuserGuests";

export const Route = createFileRoute("/superuser/guests")({
  component: () => (
    <ProtectedRoute allow={["superuser"]}>
      <SuperuserGuests />
    </ProtectedRoute>
  ),
});
