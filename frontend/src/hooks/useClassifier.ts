import { useEffect, useRef, useState } from "react";
import { checkPhoto } from "../lib/api";
import type { DetectorModel, PhotoResult } from "../lib/api";
import { useAuth } from "../lib/auth";

type Phase = "idle" | "uploading" | "classifying" | "done" | "error";
const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

export function useClassifier(onActivityChanged: () => void) {
  const { user, loading: authLoading } = useAuth();
  const activeRun = useRef(0);
  const [model, setModel] = useState<DetectorModel>("haiku");
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<PhotoResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = phase === "uploading" || phase === "classifying";

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    activeRun.current += 1;
    setResult(null);
    setCertificate(null);
    setPhase("idle");
    setError(null);
    if (!user) setFile(null);
    return () => {
      activeRun.current += 1;
    };
  }, [user?.id]);

  function clearPhoto() {
    if (busy) return;
    activeRun.current += 1;
    setFile(null);
    setDimensions(null);
    setResult(null);
    setCertificate(null);
    setPhase("idle");
    setError(null);
    setDragging(false);
  }

  function selectFile(next?: File) {
    if (!next || busy) return;
    setResult(null);
    setCertificate(null);
    setDimensions(null);
    setPhase("idle");
    if (
      !allowedTypes.includes(next.type) ||
      next.size === 0 ||
      next.size > 5 * 1024 * 1024
    ) {
      setFile(null);
      setError("Choose a JPG, PNG or WebP image up to 5 MB.");
      return;
    }
    setError(null);
    setFile(next);
  }

  async function classify() {
    if (!file || busy || !user) return;
    const run = ++activeRun.current;
    setError(null);
    setResult(null);
    setCertificate(null);
    setPhase("uploading");
    try {
      const answer = await checkPhoto(file, model, () => {
        if (run === activeRun.current) setPhase("classifying");
      });
      if (run !== activeRun.current) return;
      setResult(answer.is_hot_dog);
      setCertificate(answer);
      setPhase("done");
      onActivityChanged();
    } catch (cause) {
      if (run !== activeRun.current) return;
      setPhase("error");
      setError(
        cause instanceof DOMException && cause.name === "TimeoutError"
          ? "The check took too long. Please try again."
          : cause instanceof Error
            ? cause.message
            : "Something went wrong. Please try again.",
      );
    }
  }

  function selectModel(next: DetectorModel) {
    setModel(next);
    setResult(null);
    setCertificate(null);
    setPhase("idle");
  }

  return {
    file,
    preview,
    dimensions,
    dragging,
    model,
    phase,
    result,
    certificate,
    error,
    busy,
    signedIn: !!user,
    authLoading,
    clearPhoto,
    selectFile,
    selectModel,
    classify,
    setDimensions,
    setDragging,
  };
}
