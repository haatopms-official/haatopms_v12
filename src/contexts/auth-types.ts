export type UserRole = "superuser" | "director" | "admin" | "manager";

export interface LoginEvent {
  id: string;
  username: string;
  role: UserRole;
  action: "login" | "logout";
  at: string;
  adminId?: string | null;
  displayName?: string;
}
