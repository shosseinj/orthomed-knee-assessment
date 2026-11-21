import { useEffect, useState } from "react";
import { appointmentsApi, apiErrorMessage } from "../api/client";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { t, useLocale } from "../i18n";
import type { DoctorQR } from "../types";

export function DoctorQRPage() {
  useLocale();
  const { user } = useAuth();
  const [qr, setQr] = useState<DoctorQR | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  async function run(action: () => Promise<DoctorQR>) {
    setBusy(true);
    setError("");
    try {
      setQr(await action());
      setConfirmRotate(false);
    } catch (e) {
      setError(apiErrorMessage(e, "دریافت کد پذیرش ممکن نشد."));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (user?.is_verified) void run(appointmentsApi.qr);
  }, [user?.is_verified]);
  if (!user?.is_verified)
    return <p>{t("برای مدیریت نوبت‌ها، حساب پزشک باید تأیید شود.")}</p>;
  return (
    <>
      <Toast
        message={error || message}
        tone={error ? "error" : "success"}
        onDismiss={() => {
          setError("");
          setMessage("");
        }}
      />
      <section className="page-heading">
        <div>
          <h2>{t("QR پذیرش بیمار")}</h2>
          <p>
            {t("این کد را در پذیرش، سالن انتظار یا کنار اتاق پزشک قرار دهید.")}
          </p>
        </div>
      </section>
      {qr && (
        <section className="content-card qr-card">
          <div className="qr-print">
            <h2>{t("پذیرش در ارتومد")}</h2>
            <h3>{qr.doctor.full_name}</h3>
            <p>
              {t("برای تکمیل پرسشنامه، این کد را با تلفن همراه اسکن کنید.")}
            </p>
            <img
              className="intake-qr"
              src={qr.image}
              alt={t("QR پذیرش بیمار")}
            />
            <p className="qr-url" dir="ltr">
              {qr.url}
            </p>
          </div>
          <p role="status">
            {t(qr.is_active ? "کد پذیرش فعال است." : "کد پذیرش غیرفعال است.")}
          </p>
          <div className="qr-actions">
            <a
              className="button"
              href={qr.image}
              download="orthomed-reception.png"
            >
              {t("دانلود PNG")}
            </a>
            <button
              className="button button--secondary"
              onClick={() => window.print()}
            >
              {t("چاپ")}
            </button>
            <button
              className="button button--secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(qr.url);
                  setMessage(t("لینک کپی شد."));
                } catch {
                  setError(
                    t("کپی لینک ممکن نشد؛ لینک را از متن بالا کپی کنید."),
                  );
                }
              }}
            >
              {t("کپی لینک")}
            </button>
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={() =>
                void run(() => appointmentsApi.setQrActive(!qr.is_active))
              }
            >
              {t(qr.is_active ? "غیرفعال کردن" : "فعال کردن")}
            </button>
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={() => setConfirmRotate(true)}
            >
              {t("صدور کد جایگزین")}
            </button>
          </div>
          {confirmRotate && (
            <div className="qr-rotate-confirm">
              <p>
                {t("کد قبلی از کار می‌افتد و نسخه‌های چاپی باید جایگزین شوند.")}
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() => void run(appointmentsApi.rotateQr)}
              >
                {t("تأیید صدور کد جدید")}
              </button>
              <button
                className="button button--secondary"
                onClick={() => setConfirmRotate(false)}
              >
                {t("انصراف")}
              </button>
            </div>
          )}
        </section>
      )}
      {!qr && !busy && (
        <button className="button" onClick={() => void run(appointmentsApi.qr)}>
          {t("تلاش دوباره")}
        </button>
      )}
    </>
  );
}
