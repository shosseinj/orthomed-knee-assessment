import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { appointmentsApi, apiErrorMessage } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { t, useLocale } from "../i18n";
import { formatDate } from "../utils/dates";
import type { MedicalCase, User } from "../types";

export function PatientHistoryPage() {
  useLocale();
  const { patientId = "" } = useParams();
  const [items, setItems] = useState<MedicalCase[]>([]);
  const [patient, setPatient] = useState<User | null>(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    appointmentsApi
      .history(patientId, page)
      .then((data) => {
        if (active) {
          setItems(data.results);
          setPatient(data.patient);
          setHasNext(Boolean(data.next));
        }
      })
      .catch((e) => {
        if (active) {
          setItems([]);
          setPatient(null);
          setError(apiErrorMessage(e, "دریافت سوابق بیمار ممکن نشد."));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [patientId, page]);
  return (
    <>
      <section className="page-heading">
        <div>
          <h2>{t("سوابق بیمار")}</h2>
          {patient && <h3>{patient.full_name}</h3>}
          <p>{t("سوابق ثبت‌شده نزد پزشکان دیگر فقط قابل مشاهده هستند.")}</p>
        </div>
        <Link to="/appointments">{t("نوبت‌ها")}</Link>
      </section>
      <section className="content-card history-list">
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p>{t("در حال دریافت اطلاعات...")}</p>
        ) : items.length ? (
          items.map((item) => (
            <Link
              className="history-row"
              key={item.id}
              to={`/cases/${item.id}`}
            >
              <div>
                <strong>{t(item.title)}</strong>
                <p>{item.managing_doctor?.full_name || t("پزشک تعیین نشده")}</p>
                <small>
                  {formatDate(item.submitted_at || item.created_at)}
                </small>
              </div>
              <StatusBadge status={item.status} label={item.status_label} />
            </Link>
          ))
        ) : (
          !error && <p>{t("سابقهٔ ثبت‌شده‌ای وجود ندارد.")}</p>
        )}
        <div className="pagination">
          <button
            className="button button--secondary"
            disabled={page === 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            {t("قبلی")}
          </button>
          <span>{page}</span>
          <button
            className="button button--secondary"
            disabled={!hasNext || loading}
            onClick={() => setPage(page + 1)}
          >
            {t("بعدی")}
          </button>
        </div>
      </section>
    </>
  );
}
