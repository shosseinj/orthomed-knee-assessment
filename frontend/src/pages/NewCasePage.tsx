import { t, useLocale } from "../i18n";
import { LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { casesApi } from "../api/client";
import { useAuth } from "../context/AuthContext";

export function NewCasePage() {
  useLocale();
  const { user } = useAuth(); const navigate = useNavigate();
  useEffect(() => {
    if (user?.role !== "patient") { navigate("/dashboard", { replace: true }); return; }
    casesApi.create().then((item) => navigate(`/cases/${item.id}`, { replace: true })).catch(() => navigate("/dashboard", { replace: true }));
  }, [navigate, user]);
  return <div className="creating"><LoaderCircle className="spin" /><p>{t("در حال ساخت پرونده امن شما...")}</p></div>;
}
