import { useEffect, useState } from "react";
import { apiFileUrl } from "../api/client";
import { t, useLocale } from "../i18n";

function useAuthenticatedImage(source: string) {
  const [objectUrl, setObjectUrl] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let currentObjectUrl = "";
    setObjectUrl("");
    const token = localStorage.getItem("orthomed_access");
    void fetch(apiFileUrl(source), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    }).then((response) => {
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
  return <a href={objectUrl || undefined} target="_blank" rel="noreferrer"><img src={objectUrl || undefined} alt={t(label)} /><span>{t("مشاهده تصویر اصلی")}</span></a>;
}
