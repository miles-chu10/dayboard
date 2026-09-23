import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage, invoke } from "./ipc";

export type DictationState = "idle" | "starting" | "recording" | "transcribing";

const MAX_MS = 2 * 60_000;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the recording."));
    reader.readAsDataURL(blob);
  });
}

/** Records from the microphone and transcribes through the backend (OpenAI). */
export function useDictation(onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(
    () => () => {
      requestRef.current++;
      release();
    },
    [release],
  );

  const start = useCallback(async () => {
    const request = ++requestRef.current;
    const stale = () => requestRef.current !== request;
    setState("starting");
    try {
      const prefs = window.dayboard.systemPreferences;
      const status = await prefs.getMediaAccessStatus("microphone");
      if (status === "denied" || status === "restricted")
        throw new Error(
          "Microphone access is off. Turn it on in System Settings → Privacy & Security → Microphone.",
        );
      if (status === "not-determined" && !(await prefs.askForMediaAccess("microphone")))
        throw new Error("Microphone access wasn't granted.");
      if (stale()) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stale()) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const mimeType = ["audio/mp4", "audio/webm"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        release();
        if (stale()) return;
        setState("transcribing");
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/mp4" });
          const { text } = await invoke<{ text: string }>("assistant:transcribe", {
            audio: await toBase64(blob),
            mimeType: blob.type,
          });
          if (!stale() && text) onText(text);
        } catch (error) {
          if (!stale()) onError(errorMessage(error));
        } finally {
          if (!stale()) setState("idle");
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      timerRef.current = setTimeout(
        () => recorder.state === "recording" && recorder.stop(),
        MAX_MS,
      );
      setState("recording");
    } catch (error) {
      release();
      if (stale()) return;
      setState("idle");
      onError(errorMessage(error));
    }
  }, [onError, onText, release]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    requestRef.current++;
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
    release();
    setState("idle");
  }, [release]);

  return { state, start, stop, cancel };
}
