import { createFileRoute } from "@tanstack/react-router";
import HotelDetailsPage from "@/pages/HotelDetailsPage";

export const Route = createFileRoute("/superuser/hotel-details")({
  component: () => <HotelDetailsPage />,
});
