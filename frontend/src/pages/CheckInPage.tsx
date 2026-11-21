import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { appointmentsApi, apiErrorMessage } from "../api/client";
import { Logo } from "../components/Logo";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useAuth } from "../context/AuthContext";
import { t, useLocale } from "../i18n";

export function CheckInPage() {
  useLocale();
  const { token = "" } = useParams();
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [doctor, setDoctor] = useState<{
    full_name: string;
    medical_council_number: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [identified, setIdentified] = useState(false);
  useEffect(() => {
    let active = true;
    setDoctor(null);
    setIdentified(false);
    setError("");
    appointmentsApi
      .identify(token)
      .then((data) => {
        if (active) setDoctor(data.doctor);
      })
      .catch(() => {
        if (active) setError(t("کد پذیرش نامعتبر یا غیرفعال است."));
      })
      .finally(() => {
        if (active) setIdentified(true);
      });
    return () => {
      active = false;
    };
  }, [token]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const appointment = await appointmentsApi.checkIn(token);
      navigate(`/cases/${appointment.case_id}`, { replace: true });
    } catch (e) {
      setError(apiErrorMessage(e, "پذیرش ممکن نشد؛ دوباره تلاش کنید."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="reception-page">
      <section className="content-card reception-card">
        <Logo />
        <LanguageSwitcher />
        <h1>{t("پذیرش در ارتومد")}</h1>
        {(!identified || loading) && <p>{t("در حال دریافت اطلاعات...")}</p>}
        {doctor && (
          <>
            <h2>{doctor.full_name}</h2>
            <p>
              {t("شماره نظام پزشکی")}: {doctor.medical_council_number || "—"}
            </p>
            <p>
              {t(
                "با شروع پذیرش، این پزشک به پروندهٔ مراجعه و سوابق ثبت‌شدهٔ شما دسترسی خواهد داشت.",
              )}
            </p>
            {!loading &&
              (user?.role === "patient" ? (
                <button
                  className="button button--wide"
                  disabled={busy}
                  onClick={() => void start()}
                >
                  {t("شروع پذیرش و تکمیل پرسشنامه")}
                </button>
              ) : user ? (
                <>
                  <p>{t("برای پذیرش با حساب بیمار وارد شوید.")}</p>
                  <button className="button" onClick={logout}>
                    {t("خروج و ورود با حساب بیمار")}
                  </button>
                </>
              ) : (
                <Link
                  className="button button--wide"
                  to={`/login?next=${encodeURIComponent(`/check-in/${token}`)}`}
                >
                  {t("ورود یا ثبت‌نام بیمار")}
                </Link>
              ))}
          </>
        )}
        {error && (
          <p role="alert" className="reception-error">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
