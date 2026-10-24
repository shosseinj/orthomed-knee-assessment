import { useLocale } from "../i18n";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute() {
  useLocale();
  const { user, loading } = useAuth();
  if (loading) return <div className="fullscreen-loader"><span /></div>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
