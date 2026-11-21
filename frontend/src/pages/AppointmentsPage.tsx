import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, LoaderCircle, Plus } from "lucide-react";
import { appointmentsApi, apiErrorMessage } from "../api/client";
import { DatePicker } from "../components/BirthDatePicker";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { t, useLocale } from "../i18n";
import { formatAppointmentTime, todayInTehran } from "../utils/dates";
import type { Appointment, AppointmentStatus } from "../types";

function BookingTime({
  date,
  time,
  onDate,
  onTime,
}: {
  date: string;
  time: string;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
}) {
  const today = todayInTehran();
  return (
    <div className="booking-time">
      <div className="field">
        <span>{t("تاریخ مراجعه")}</span>
        <DatePicker
          value={date}
          onChange={onDate}
          min={today}
          max={`${Number(today.slice(0, 4)) + 5}-12-31`}
          label="تاریخ مراجعه"
          required
        />
      </div>
      <label className="field">
        <span>{t("ساعت مراجعه (تهران)")}</span>
        <input
          type="time"
          required
          value={time}
          onChange={(event) => onTime(event.target.value)}
        />
      </label>
    </div>
  );
}

export function AppointmentsPage() {
  useLocale();
  const { user } = useAuth();
  const doctor = user?.role === "doctor";
  const [items, setItems] = useState<Appointment[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(todayInTehran());
  const [time, setTime] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const approved = !doctor || user?.is_verified;
  async function load() {
    if (!approved) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await appointmentsApi.list(page);
      setItems(data.results);
      setHasNext(Boolean(data.next));
    } catch (e) {
      setError(apiErrorMessage(e, "دریافت نوبت‌ها ممکن نشد."));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [page, approved]);

  async function book(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await appointmentsApi.create(phone, `${date}T${time}:00+03:30`);
      setPhone("");
      setMessage(
        t("نوبت ثبت شد؛ پرسشنامه در پنل بیمار در دسترس قرار می‌گیرد."),
      );
      if (page === 1) await load();
      else setPage(1);
    } catch (e) {
      setError(apiErrorMessage(e, "ثبت نوبت ممکن نشد."));
    } finally {
      setBusy(false);
    }
  }
  async function update(
    id: string,
    changes: { status?: AppointmentStatus; scheduled_at?: string },
  ) {
    setBusy(true);
    setError("");
    try {
      await appointmentsApi.update(id, changes);
      setEditing(null);
      setMessage(t("نوبت به‌روزرسانی شد."));
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, "تغییر نوبت ممکن نشد."));
    } finally {
      setBusy(false);
    }
  }
  if (!approved)
    return (
      <section className="content-card">
        <p>{t("برای مدیریت نوبت‌ها، حساب پزشک باید تأیید شود.")}</p>
        <Link to="/dashboard">{t("بازگشت به پرونده‌ها")}</Link>
      </section>
    );
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
          <span className="eyebrow">
            {t(doctor ? "پنل پزشک" : "پنل بیمار")}
          </span>
          <h2>{t("نوبت‌ها")}</h2>
          <p>{t("تاریخ و ساعت نوبت‌ها به وقت تهران است.")}</p>
        </div>
        {doctor && (
          <Link className="button button--secondary" to="/doctor-qr">
            {t("QR پذیرش بیمار")}
          </Link>
        )}
      </section>
      {doctor && (
        <section className="content-card booking-card">
          <h3>
            <CalendarDays size={20} /> {t("ثبت نوبت")}
          </h3>
          <form onSubmit={book}>
            <label className="field">
              <span>{t("شماره موبایل بیمار")}</span>
              <input
                inputMode="tel"
                dir="ltr"
                required
                placeholder="09xxxxxxxxx"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </label>
            <BookingTime
              date={date}
              time={time}
              onDate={setDate}
              onTime={setTime}
            />
            <p className="muted">
              {t(
                "اگر بیمار حساب ندارد، نوبت پس از ثبت‌نام با همین شماره به او متصل می‌شود.",
              )}
            </p>
            <button className="button" disabled={busy || !time || !date}>
              <Plus size={18} />
              {t("ثبت نوبت")}
            </button>
          </form>
        </section>
      )}
      <section className="content-card appointment-list">
        <header className="card-header">
          <h3>{t(doctor ? "نوبت‌های بیماران" : "نوبت‌های من")}</h3>
          <button
            className="button button--secondary"
            disabled={loading || busy}
            onClick={() => void load()}
          >
            {t("تازه‌سازی")}
          </button>
        </header>
        {loading ? (
          <LoaderCircle className="spin" />
        ) : !items.length ? (
          <p>{t("هنوز نوبتی ثبت نشده است.")}</p>
        ) : (
          items.map((item) => (
            <article key={item.id} className="appointment-row">
              <div>
                <strong>
                  {doctor
                    ? item.patient?.full_name || item.phone_number
                    : item.doctor.full_name}
                </strong>
                <p>{formatAppointmentTime(item.scheduled_at)}</p>
                {doctor && <small dir="ltr">{item.phone_number}</small>}
                <span
                  className={`appointment-status appointment-status--${item.status}`}
                >
                  {t(item.status_label)}
                </span>
                {!item.patient && (
                  <p className="muted">{t("در انتظار ثبت‌نام بیمار")}</p>
                )}
              </div>
              <div className="appointment-actions">
                {item.case_id && (
                  <Link
                    className="button button--secondary"
                    to={`/cases/${item.case_id}`}
                  >
                    {t(
                      doctor
                        ? "مشاهده پرونده"
                        : item.status === "cancelled" ||
                            item.status === "completed"
                          ? "مشاهده پرونده"
                          : "تکمیل پرسشنامه",
                    )}
                  </Link>
                )}
                {doctor && item.patient && item.status !== "cancelled" && (
                  <Link to={`/patients/${item.patient.id}/history`}>
                    {t("سوابق بیمار")}
                  </Link>
                )}
                {doctor && item.status === "scheduled" && (
                  <>
                    <button
                      className="button button--secondary"
                      disabled={busy}
                      onClick={() => {
                        setEditing(item.id);
                        const parts = new Intl.DateTimeFormat("sv-SE", {
                          timeZone: "Asia/Tehran",
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hourCycle: "h23",
                        })
                          .format(new Date(item.scheduled_at))
                          .split(" ");
                        setEditDate(parts[0]);
                        setEditTime(parts[1]);
                      }}
                    >
                      {t("تغییر زمان")}
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={busy}
                      onClick={() =>
                        void update(item.id, { status: "cancelled" })
                      }
                    >
                      {t("لغو نوبت")}
                    </button>
                    {item.patient && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          void update(item.id, { status: "checked_in" })
                        }
                      >
                        {t("پذیرش بیمار")}
                      </button>
                    )}
                  </>
                )}
                {doctor && item.status === "checked_in" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void update(item.id, { status: "completed" })
                    }
                  >
                    {t("پایان مراجعه")}
                  </button>
                )}
              </div>
              {editing === item.id && (
                <form
                  className="reschedule-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void update(item.id, {
                      scheduled_at: `${editDate}T${editTime}:00+03:30`,
                    });
                  }}
                >
                  <BookingTime
                    date={editDate}
                    time={editTime}
                    onDate={setEditDate}
                    onTime={setEditTime}
                  />
                  <button
                    className="button"
                    disabled={busy || !editDate || !editTime}
                  >
                    {t("ذخیره زمان")}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => setEditing(null)}
                  >
                    {t("انصراف")}
                  </button>
                </form>
              )}
            </article>
          ))
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
