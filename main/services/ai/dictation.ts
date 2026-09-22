import { getApiKey } from "./api-keys.js";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MODELS = ["gpt-4o-mini-transcribe", "whisper-1"];

export async function transcribe(
  audioBase64: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<string> {
  const key = await getApiKey("openai");
  if (!key) throw new Error("Add an OpenAI API key in Settings → AI to use dictation.");
  const audio = Buffer.from(audioBase64, "base64");
  if (!audio.length) throw new Error("No audio was recorded.");
  if (audio.length > MAX_AUDIO_BYTES) throw new Error("That recording is too long to transcribe.");
  const extension = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : "m4a";

  let lastError = "Transcription failed.";
  for (const model of MODELS) {
    const form = new FormData();
    form.append("model", model);
    form.append("file", new Blob([audio], { type: mimeType }), `dictation.${extension}`);
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
    });
    if (response.ok) {
      const body = (await response.json()) as { text?: unknown };
      return typeof body.text === "string" ? body.text.trim() : "";
    }
    if (response.status === 401)
      throw new Error("OpenAI rejected the API key. Update it in Settings → AI.");
    if (response.status === 429)
      throw new Error(
        "OpenAI rate limit or quota reached. Check your OpenAI billing and try again.",
      );
    lastError = `OpenAI transcription failed (${response.status}).`;
    // Try the next model only when this one isn't available to the key.
    if (response.status !== 404 && response.status !== 400) break;
  }
  throw new Error(lastError);
}
