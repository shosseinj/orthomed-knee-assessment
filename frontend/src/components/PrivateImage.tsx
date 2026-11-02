import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { apiFileUrl, authenticatedFetch } from "../api/client";
import { t, useLocale } from "../i18n";

function useAuthenticatedImage(source: string) {
  const [objectUrl, setObjectUrl] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let currentObjectUrl = "";
    setObjectUrl("");
    void authenticatedFetch(apiFileUrl(source), { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("Image request failed");
      return response.blob();
    }).then((blob) => {
      currentObjectUrl = URL.createObjectURL(blob);
      setObjectUrl(currentObjectUrl);
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setObjectUrl("");
    });
    return () => {
      controller.abort();
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [source]);
  return objectUrl;
}

export function AuthenticatedImage({ source, alt }: { source: string; alt: string }) {
  useLocale();
  const objectUrl = useAuthenticatedImage(source);
  return <img src={objectUrl || undefined} alt={alt} />;
}

export function AuthenticatedImageLink({ source, label = "X-ray زانو" }: { source: string; label?: string }) {
  useLocale();
  const objectUrl = useAuthenticatedImage(source);
  return <a className="private-image-link" href={objectUrl || undefined} target="_blank" rel="noreferrer" aria-label={`${t("مشاهده تصویر اصلی")} — ${t(label)}`}>
    <img src={objectUrl || undefined} alt={t(label)} />
    <span className="private-image-link__label"><ExternalLink size={16} aria-hidden="true" />{t("مشاهده تصویر اصلی")}</span>
  </a>;
}
