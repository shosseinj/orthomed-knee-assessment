import { useLocale } from "./i18n";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute, RoleRoute } from "./components/ProtectedRoute";
import { CaseDetailPage } from "./pages/CaseDetailPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { NewCasePage } from "./pages/NewCasePage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";
import { AccountManagementPage } from "./pages/AccountManagementPage";

export function App() {
  useLocale();
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AppShell />}>
        <Route element={<RoleRoute roles={["patient", "doctor", "insurance"]} />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/cases/:id" element={<CaseDetailPage />} />
        </Route>
        <Route element={<RoleRoute roles={["patient"]} />}>
          <Route path="/cases/new" element={<NewCasePage />} />
        </Route>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/management" element={<AccountManagementPage />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>;
}
