import { useEffect, useRef, useState } from "react";
import { AlertCircle, FileImage, LoaderCircle, Trash2 } from "lucide-react";
import { apiErrorMessage, casesApi } from "../api/client";
import { locale, t, useLocale } from "../i18n";
import { formatDate } from "../utils/dates";
import type { KneeSide, KneeView, XRayImage } from "../types";
import { AuthenticatedImage } from "./PrivateImage";
import "../styles/knee-images.css";

const sides: Record<KneeSide, string> = { right: "زانوی راست", left: "زانوی چپ", bilateral: "هر دو زانو", unknown: "سمت زانو نامشخص" };
const views: Record<KneeView, string> = { frontal: "رخ", lateral: "نیم‌رخ", skyline: "نمای کشکک", other: "نمای دیگر", unknown: "نمای نامشخص" };
const statuses = { pending: "در انتظار طبقه‌بندی", processing: "در حال طبقه‌بندی", completed: "طبقه‌بندی‌شده", failed: "طبقه‌بندی ناموفق", needs_confirmation: "نیازمند تأیید" };
const qualities = { adequate: "کافی", limited: "محدود", unusable: "غیرقابل استفاده", unknown: "نامشخص" };

function assignment(side?: KneeSide | null, view?: KneeView | null) {
  return `${t(views[view || "unknown"])} — ${t(sides[side || "unknown"])}`;
}

function hasClassification(image: XRayImage) {
  return Boolean(image.classified_at && image.classification_reason);
}

function confirmationDraft(image: XRayImage): { side: KneeSide; view: KneeView; reason: string } {
  if (image.confirmed_at) return {
    side: image.confirmed_side ?? image.effective_side ?? "unknown",
    view: image.confirmed_view ?? image.effective_view ?? "unknown",
    reason: image.confirmation_reason || "",
  };
  if (hasClassification(image)) {
    const canUseDeclaration = image.is_knee_xray !== false && image.quality_status !== "unusable" && !image.ambiguous_evidence;
    return {
      side: image.detected_side && image.detected_side !== "unknown" ? image.detected_side : canUseDeclaration ? image.declared_side || "unknown" : "unknown",
      view: image.detected_view && image.detected_view !== "unknown" ? image.detected_view : canUseDeclaration ? image.declared_view || "unknown" : "unknown",
      reason: image.classification_reason!.slice(0, 500),
    };
  }
  return { side: image.effective_side || image.declared_side || "unknown",
    view: image.effective_view || image.declared_view || "unknown", reason: "" };
}

function confirmationVersion(image: XRayImage) {
  return JSON.stringify([image.confirmed_at, image.confirmed_side, image.confirmed_view, image.confirmation_reason]);
}

function ImageWarnings({ image }: { image: XRayImage }) {
  return <>
    {image.is_knee_xray === false && <strong className="knee-warning">{t("هوش مصنوعی این تصویر را رادیوگرافی زانو تشخیص نداده است.")}</strong>}
    {image.ambiguous_evidence && <strong className="knee-warning">{t("شواهد سمت زانو مبهم یا متناقض است.")}</strong>}
  </>;
}

export function ImageCaption({ image, index }: { image: XRayImage; index: number }) {
  useLocale();
  const { side, view } = confirmationDraft(image);
  const reason = image.confirmation_reason || image.classification_reason;
  const marker = image.visible_marker === "none" ? t("ندارد") : image.visible_marker === "both" ? "R / L" : image.visible_marker === "R" || image.visible_marker === "L" ? image.visible_marker : t("نامشخص");
  return <figcaption className="knee-caption">
    <div className="knee-caption__heading">
      <strong>{t("عکس {0}: {1}", { 0: (index + 1).toLocaleString(locale()), 1: assignment(side, view) })}</strong>
      <span className={`knee-caption__status ${image.confirmed_at ? "knee-confirmed" : "knee-warning"}`}>{t(image.confirmed_at ? "تأیید کاربر" : image.organized ? "نیازمند تأیید" : "تصویر قدیمی؛ طبقه‌بندی نشده")}</span>
    </div>
    <ImageWarnings image={image} />
    {reason && <p>{reason}</p>}
    {(hasClassification(image) || image.confirmed_at) && <details className="knee-evidence">
      <summary>{t("جزئیات بررسی تصویر")}</summary>
      <dl>
        <div><dt>{t("انتخاب هنگام بارگذاری")}</dt><dd>{assignment(image.declared_side, image.declared_view)}</dd></div>
        {hasClassification(image) && <>
          <div><dt>{t("تشخیص مستقل هوش مصنوعی")}</dt><dd>{assignment(image.detected_side, image.detected_view)}</dd></div>
          <div><dt>{t("نشانگر قابل مشاهده")}</dt><dd>{marker}</dd></div>
          <div><dt>{t("کیفیت برای طبقه‌بندی")}</dt><dd>{t(qualities[image.quality_status || "unknown"])}</dd></div>
        </>}
        {image.confirmed_at && <div><dt>{t("تأیید کاربر")}</dt><dd>{formatDate(image.confirmed_at)}</dd></div>}
      </dl>
      {image.confirmation_reason && image.classification_reason && image.confirmation_reason !== image.classification_reason && <p>{image.classification_reason}</p>}
    </details>}
  </figcaption>;
}

type ManagerProps = { caseId: string; images: XRayImage[]; onRefresh: () => Promise<unknown>; onBusyChange: (busy: boolean) => void };

export function KneeImageManager({ caseId, images, onRefresh, onBusyChange }: ManagerProps) {
  useLocale();
  const [uploading, setUploading] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [classifying, setClassifying] = useState<string[]>([]);

  async function classify(imageId: string) {
    setClassifying((current) => [...current, imageId]);
    try { return await casesApi.classifyImage(imageId); }
    catch { setError(t("طبقه‌بندی خودکار در دسترس نیست؛ تصویر حفظ شده است. دستی تأیید کنید یا دوباره تلاش کنید.")); return null; }
    finally {
      try { await onRefresh(); }
      finally { setClassifying((current) => current.filter((id) => id !== imageId)); }
    }
  }

  async function upload(file: File | undefined, side: KneeSide, view: KneeView, replacement?: XRayImage) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 12 * 1024 * 1024) {
      setError(t("بارگذاری تصویر ممکن نشد. فرمت و حجم فایل را بررسی کنید.")); return;
    }
    const key = `${side}_${view}`;
    setUploading(key); setProgress(0); setError(""); onBusyChange(true);
    const data = new FormData(); data.append("image", file); data.append("purpose", "xray");
    data.append("declared_side", side); data.append("declared_view", view);
    if (replacement) data.append("replace_image_id", replacement.id);
    try {
      const image = await casesApi.uploadImage(caseId, data, setProgress);
      await onRefresh();
      void classify(image.id);
    } catch (e) { setError(apiErrorMessage(e, "بارگذاری تصویر ممکن نشد. فرمت و حجم فایل را بررسی کنید.")); }
    finally { setUploading(""); onBusyChange(false); }
  }

  function fileControl(side: KneeSide, view: KneeView, replacement?: XRayImage) {
    const key = `${side}_${view}`;
    return <label className={`knee-file-control ${uploading ? "disabled" : ""}`}>
      <span>{t(replacement ? "جایگزینی تصویر" : "تصویر را انتخاب کنید")}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(uploading)}
        aria-label={`${t(replacement ? "جایگزینی تصویر" : "تصویر را انتخاب کنید")} — ${assignment(side, view)}`}
        onChange={(event) => { void upload(event.target.files?.[0], side, view, replacement); event.target.value = ""; }} />
      {uploading === key && <span role="status">{t("در حال بارگذاری")}: {progress.toLocaleString(locale())}%<progress aria-label={t("پیشرفت بارگذاری")} max={100} value={progress} /></span>}
    </label>;
  }

  function imageCard(image: XRayImage) {
    return <ImageReview key={image.id} image={image} index={images.findIndex((row) => row.id === image.id)}
      classifying={classifying.includes(image.id)} onClassify={() => classify(image.id)}
      onRefresh={onRefresh} uploadBusy={Boolean(uploading)}
      replacement={fileControl(image.effective_side || image.declared_side || "unknown", image.effective_view || image.declared_view || "unknown", image)} />;
  }

  return <section className="content-card knee-manager">
    <header className="section-title"><span><FileImage /></span><div><h3>{t("تصاویر رادیولوژی")}</h3><p>{t("فقط تصاویر زانوی مربوط را بارگذاری کنید؛ تکمیل هر چهار جایگاه الزامی نیست.")}</p></div></header>
    <p className="clinical-help">{t("انتخاب جایگاه، تشخیص مستقل هوش مصنوعی نیست. سمت و نمای هر تصویر جدید را پیش از ارسال تأیید کنید.")}</p>
    <small>{t("JPG، PNG یا WebP تا ۱۲ مگابایت")}</small>
    {error && <p role="alert" className="ai-error">{error}</p>}
    <div className="knee-sections">{(["right", "left"] as const).map((side) => <section className="knee-section" key={side} aria-label={t(sides[side])}>
      <h4>{t(sides[side])}</h4>
      {(["frontal", "lateral"] as const).map((view) => {
        const key = `${side}_${view}`;
        const image = images.find((row) => row.slot_key === key);
        return <section className="knee-slot" key={key} data-slot={key} aria-label={assignment(side, view)}>
          <h5>{t(view === "frontal" ? "رخ / Frontal" : "نیم‌رخ / Lateral")}</h5>
          {image ? imageCard(image) : <><p>{t("تصویری بارگذاری نشده (اختیاری)")}</p>{fileControl(side, view)}</>}
        </section>;
      })}
    </section>)}</div>
    <section className="knee-unassigned" aria-label={t("تصاویر دوطرفه یا بدون جایگاه")}>
      <h4>{t("تصاویر دوطرفه یا بدون جایگاه")}</h4>
      <p>{t("تصاویر قدیمی، دوطرفه و نامشخص برای بازبینی در این بخش باقی می‌مانند.")}</p>
      <div className="knee-unassigned-upload">
        <p className="field-help">{t("تصویر را بدون انتخاب سمت و نما بارگذاری کنید؛ مدل تصویر را بررسی می‌کند و پیشنهاد سمت زانو، نما و توضیح را خودکار در فرم قرار می‌دهد.")}</p>
        {fileControl("unknown", "unknown")}
      </div>
      <div className="knee-review-grid">{images.filter((image) => !image.slot_key).map(imageCard)}</div>
    </section>
  </section>;
}

function ImageReview({ image, index, classifying, onClassify, onRefresh, uploadBusy, replacement }: {
  image: XRayImage; index: number; classifying: boolean; onClassify: () => Promise<XRayImage | null>;
  onRefresh: () => Promise<unknown>; uploadBusy: boolean; replacement: React.ReactNode;
}) {
  const [draft, setDraft] = useState(() => confirmationDraft(image));
  const edited = useRef({ side: false, view: false, reason: false });
  const editCounts = useRef({ side: 0, view: 0, reason: 0 });
  const savedConfirmation = useRef(confirmationVersion(image));
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const { side, view, reason } = draft;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const version = confirmationVersion(image);
    if (version !== savedConfirmation.current) {
      savedConfirmation.current = version;
      edited.current = { side: false, view: false, reason: false };
    }
    const suggestion = confirmationDraft(image);
    setDraft((current) => {
      const next = { side: edited.current.side ? current.side : suggestion.side,
        view: edited.current.view ? current.view : suggestion.view,
        reason: edited.current.reason ? current.reason : suggestion.reason };
      return current.side === next.side && current.view === next.view && current.reason === next.reason ? current : next;
    });
  }, [image]);

  useEffect(() => {
    const resizeNote = () => {
      const note = noteRef.current;
      if (!note) return;
      note.style.height = "auto";
      note.style.height = `${note.scrollHeight + 2}px`;
      if (document.activeElement !== note) note.scrollTop = 0;
    };
    resizeNote();
    window.addEventListener("resize", resizeNote);
    return () => window.removeEventListener("resize", resizeNote);
  }, [reason]);

  function edit<Field extends keyof typeof draft>(field: Field, value: typeof draft[Field]) {
    edited.current[field] = true;
    editCounts.current[field] += 1;
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function classifyAgain() {
    const startedWith = { ...editCounts.current };
    const result = await onClassify();
    if (!result || image.confirmed_at) return;
    const suggestion = confirmationDraft(result);
    const changedDuringRequest = {
      side: editCounts.current.side !== startedWith.side,
      view: editCounts.current.view !== startedWith.view,
      reason: editCounts.current.reason !== startedWith.reason,
    };
    edited.current = changedDuringRequest;
    setDraft((current) => ({
      side: changedDuringRequest.side ? current.side : suggestion.side,
      view: changedDuringRequest.view ? current.view : suggestion.view,
      reason: changedDuringRequest.reason ? current.reason : suggestion.reason,
    }));
  }

  const conflict = hasClassification(image) && (
    Boolean(image.declared_side && image.declared_side !== "unknown" && image.detected_side && image.detected_side !== "unknown" && image.detected_side !== image.declared_side)
    || Boolean(image.declared_view && image.declared_view !== "unknown" && image.detected_view && image.detected_view !== "unknown" && image.detected_view !== image.declared_view)
  );
  async function confirm() {
    setBusy(true); setError("");
    try { await casesApi.confirmImage(image.id, side, view, reason); await onRefresh(); }
    catch (e) { setError(apiErrorMessage(e, "تأیید تصویر ممکن نشد.")); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError("");
    try { await casesApi.deleteImage(image.id); await onRefresh(); }
    catch (e) { setError(apiErrorMessage(e, "حذف تصویر ممکن نشد. دوباره تلاش کنید.")); }
    finally { setBusy(false); }
  }
  return <figure className="knee-image" data-image-id={image.id}>
    <AuthenticatedImage source={image.image_url} alt={t("تصویر رادیولوژی زانو")} />
    {image.confirmed_at ? <figcaption className="knee-confirmed">{t("تأیید کاربر")} · {formatDate(image.confirmed_at)}</figcaption>
      : !image.organized && <figcaption>{t("تصویر قدیمی؛ طبقه‌بندی نشده")}</figcaption>}
    <ImageWarnings image={image} />
    <span role="status">{classifying ? <><LoaderCircle className="spin" size={14} /> {t("در حال طبقه‌بندی")}</> : t(statuses[image.classification_status || "pending"])}</span>
    {conflict && !image.confirmed_at && <p className="knee-warning"><AlertCircle size={16} />{t("تشخیص مدل با جایگاه انتخابی متفاوت است. هر دو مقدار را بررسی و جایگاه را تأیید یا اصلاح کنید.")}</p>}
    {image.classification_error && <p role="alert" className="knee-warning">{t("طبقه‌بندی خودکار در دسترس نیست؛ تصویر حفظ شده است. دستی تأیید کنید یا دوباره تلاش کنید.")}</p>}
    <button className="button button--secondary" type="button" disabled={classifying || busy} onClick={() => void classifyAgain()}>{t("طبقه‌بندی / تلاش دوباره")}</button>
    <fieldset className="knee-confirmation" disabled={busy || uploadBusy}>
      <legend>{t("تأیید یا اصلاح جایگاه")}</legend>
      <label>{t("سمت زانو")}<select value={side} onChange={(event) => edit("side", event.target.value as KneeSide)}>{Object.entries(sides).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
      {hasClassification(image) && image.detected_side === "unknown" && side !== "unknown" && side === image.declared_side && <p className="field-help">{t("سمت فرم از انتخاب شما هنگام بارگذاری است؛ مدل سمت را تأیید نکرده است.")}</p>}
      <label>{t("نمای تصویر")}<select value={view} onChange={(event) => edit("view", event.target.value as KneeView)}>{Object.entries(views).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
      {hasClassification(image) && image.detected_view === "unknown" && view !== "unknown" && view === image.declared_view && <p className="field-help">{t("نمای فرم از انتخاب شما هنگام بارگذاری است؛ مدل نما را تأیید نکرده است.")}</p>}
      <label>{t("دلیل / یادداشت تأیید")}<textarea ref={noteRef} dir="auto" rows={5} value={reason} maxLength={500} onChange={(event) => edit("reason", event.target.value)} required={side === "unknown" || view === "unknown"} /></label>
      <button className="button" type="button" onClick={() => void confirm()} disabled={(side === "unknown" || view === "unknown") && !reason.trim()}>{t("تأیید جایگاه تصویر")}</button>
    </fieldset>
    {error && <p role="alert" className="ai-error">{error}</p>}
    <div className="knee-image-actions">{replacement}<button className="image-remove" type="button" disabled={busy || uploadBusy} onClick={() => void remove()} aria-label={t("حذف تصویر {0}", { 0: index + 1 })}><Trash2 size={16} />{t("حذف تصویر")}</button></div>
  </figure>;
}
