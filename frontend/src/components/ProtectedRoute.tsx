import { useLocale } from "../i18n";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";

export function ProtectedRoute() {
  useLocale();
  const { user, loading } = useAuth();
  if (loading) return <div className="fullscreen-loader"><span /></div>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

export function RoleRoute({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.can_manage_accounts || user.role === "admin") return <Navigate to="/management" replace />;
  return roles.includes(user.role) ? <Outlet /> : <Navigate to="/dashboard" replace />;
}
