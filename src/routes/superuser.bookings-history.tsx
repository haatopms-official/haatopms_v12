import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import SuperuserBookingsHistory from "@/pages/SuperuserBookingsHistory";

export const Route = createFileRoute("/superuser/bookings-history")({
  component: () => (
    <ProtectedRoute allow={["superuser"]}>
      <SuperuserBookingsHistory />
    </ProtectedRoute>
  ),
});
