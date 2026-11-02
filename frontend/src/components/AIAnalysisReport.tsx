import { useId } from "react";
import { AlertCircle, BrainCircuit } from "lucide-react";
import { locale, t, useLocale } from "../i18n";
import { formatDate } from "../utils/dates";
import type { Assessment } from "../types";
import "../styles/ai-report.css";

type Block = { kind: "paragraph" | "unordered" | "ordered"; items: string[]; ordinals?: number[] };
type ReportSection = { title: string; blocks: Block[] };

// Format the saved answer without generating a new interpretation or summary.
export function splitAIReport(text: string): ReportSection[] {
  const sections: ReportSection[] = [];
  let section: ReportSection = { title: "", blocks: [] };
  let paragraph: string[] = [];
  function flushParagraph() {
    if (!paragraph.length) return;
    const sentences = paragraph.join(" ").split(/(?<=[.!?؟])\s+(?=[^\d۰-۹٠-٩])/u);
    let chunk = "";
    for (const sentence of sentences) {
      if (chunk && chunk.length + sentence.length > 420) {
        section.blocks.push({ kind: "paragraph", items: [chunk] });
        chunk = "";
      }
      chunk = chunk ? `${chunk} ${sentence}` : sentence;
    }
    if (chunk) section.blocks.push({ kind: "paragraph", items: [chunk] });
    paragraph = [];
  }
  const knownHeading = /^(?:تصاویر|یافته|داده|اطلاعات|شرح حال|تحلیل|جمع.?بندی|نتیجه|نیاز به بررسی|دلایل|پیشنهاد|بررسی|محدودیت|imaging|image findings|clinical|assessment|conclusion|follow.up|limitations)/iu;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { flushParagraph(); continue; }
    const candidate = line.replace(/^(?:[-*•]\s+|[\d۰-۹٠-٩]+[.)٫]\s+)/u, "");
    const markdownHeading = candidate.match(/^#{1,6}\s+(.+)$/u);
    const boldHeading = candidate.match(/^\*\*([^*\n]{2,100})\*\*[:：]?$/u);
    const colonHeading = candidate.match(/^([^:：]{2,100})[:：]\s*(.*)$/u);
    const title = markdownHeading?.[1] || boldHeading?.[1] || colonHeading?.[1]?.replace(/^\*{1,2}|\*{1,2}$/g, "").trim();
    const normalizedTitle = title?.replace(/[كي]/g, (letter) => letter === "ك" ? "ک" : "ی").replace(/\u200c/g, " ");
    const isHeading = markdownHeading || boldHeading || (colonHeading && (knownHeading.test(normalizedTitle || "") || (!colonHeading[2] && candidate === line)));
    if (isHeading && title) {
      flushParagraph();
      if (section.title || section.blocks.length) sections.push(section);
      section = { title: title.replace(/[:：]$/, ""), blocks: [] };
      let body = markdownHeading || boldHeading ? "" : colonHeading?.[2];
      if (colonHeading?.[1].startsWith("**") && !colonHeading[1].endsWith("**")) body = body?.replace(/^\*\*\s*/, "");
      if (body) paragraph.push(body);
      continue;
    }
    const bullet = line.match(/^(?:([-*•])\s+|([\d۰-۹٠-٩]+)[.)٫]\s+)(.+)$/u);
    if (bullet) {
      flushParagraph();
      const kind = bullet[2] ? "ordered" : "unordered";
      const ordinal = bullet[2] ? Number(bullet[2].replace(/[۰-۹٠-٩]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(digit) % 10))) : undefined;
      const last = section.blocks.at(-1);
      if (last?.kind === kind) { last.items.push(bullet[3]); if (ordinal !== undefined) last.ordinals?.push(ordinal); }
      else section.blocks.push({ kind, items: [bullet[3]], ...(ordinal !== undefined ? { ordinals: [ordinal] } : {}) });
    } else paragraph.push(line);
  }
  flushParagraph();
  if (section.title || section.blocks.length) sections.push(section);
  return sections;
}

function inlineText(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong>
      : /^[0-9a-f]{8}-/i.test(part) ? <bdi className="ai-report__reference" dir="ltr" key={index}>{part}</bdi> : part);
}

export function AIAnalysisReport({ assessment }: { assessment: Assessment }) {
  useLocale();
  const headingId = useId();
  const sections = splitAIReport(assessment.rationale);
  if (assessment.clinical_history?.trim()) sections.push({ title: t("شرح حال"), blocks: [{ kind: "paragraph", items: [assessment.clinical_history] }] });
  return <section className="assessment-card assessment-card--ai ai-report" aria-labelledby={headingId}>
    <header><span><BrainCircuit aria-hidden="true" /></span><div><small>{t(assessment.source_label)}</small><h3 id={headingId}>{t("نتیجه تحلیل هوشمند")}</h3></div>{assessment.created_at && <time dateTime={assessment.created_at}>{formatDate(assessment.created_at)}</time>}</header>
    <div className={`ai-report__summary ai-report__summary--${assessment.verdict}`}>
      <div><span>{t("جمع‌بندی مدل")}</span><strong>{t(assessment.verdict_label)}</strong></div>
      <div className="ai-report__grade"><span>{t("درجه KL:")}</span><strong>{assessment.kl_grade == null ? t("قابل برآورد نیست") : <bdi dir="ltr">KL {assessment.kl_grade.toLocaleString(locale())}</bdi>}</strong></div>
    </div>
    <div className="ai-report__sections">{sections.map((section, index) => <section className={`ai-report__section ${section.blocks.length === 1 && section.blocks[0].kind === "paragraph" && section.blocks[0].items[0].length < 36 ? "ai-report__section--brief" : ""}`} key={index} aria-labelledby={`${headingId}-${index}`}>
      <h4 id={`${headingId}-${index}`}><span aria-hidden="true">{(index + 1).toLocaleString(locale())}</span>{section.title || t("استدلال")}</h4>
      {section.blocks.map((block, blockIndex) => block.kind === "paragraph" ? <p dir="auto" key={blockIndex}>{inlineText(block.items[0])}</p>
        : block.kind === "ordered" ? <ol key={blockIndex}>{block.items.map((item, itemIndex) => <li dir="auto" value={block.ordinals?.[itemIndex]} key={itemIndex}>{inlineText(item)}</li>)}</ol>
          : <ul key={blockIndex}>{block.items.map((item, itemIndex) => <li dir="auto" key={itemIndex}>{inlineText(item)}</li>)}</ul>)}
    </section>)}</div>
    <footer><AlertCircle size={17} aria-hidden="true" />{t("این نتیجه جایگزین تشخیص پزشک نیست.")}</footer>
  </section>;
}
