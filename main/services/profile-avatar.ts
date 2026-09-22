import * as fs from "node:fs/promises";
import * as path from "node:path";

import { app, dialog, nativeImage } from "@glaze/core/backend";

import { assertNotDemo, isDemoMode } from "./demo-data.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "./file-store.js";

const AVATAR_SIZE = 256;
const queue = createSerialQueue();

function avatarPath(): string {
  return path.join(app.getPath("userData"), isDemoMode() ? "demo-profile-avatar.jpg" : "profile-avatar.jpg");
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function readAvatarDataUrl(): Promise<string | null> {
  const raw = await readFileIfExists(avatarPath());
  return raw && raw.length ? toDataUrl(raw) : null;
}

export async function getProfileAvatar(): Promise<string | null> {
  return queue(() => readAvatarDataUrl());
}

export async function pickProfileAvatar(): Promise<string | null> {
  assertNotDemo("profile:pickAvatar");
  return queue(async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose Profile Picture",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "heic"] }],
    });
    if (result.canceled || !result.filePaths[0]) return await readAvatarDataUrl();

    const source = nativeImage.createFromPath(result.filePaths[0]);
    if (source.isEmpty()) throw new Error("That file isn't a usable image.");

    const { width, height } = source.getSize();
    const longest = Math.max(width, height, 1);
    const scale = Math.min(1, AVATAR_SIZE / longest);
    const resized =
      scale < 1
        ? await source.resize({
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
            quality: "better",
          })
        : source;
    if (resized.isEmpty()) throw new Error("Couldn't resize that image.");

    const jpeg = resized.toJPEG(88);
    if (!jpeg.length) throw new Error("Couldn't save that image.");
    await writeFileAtomic(avatarPath(), jpeg);
    return toDataUrl(jpeg);
  });
}

export async function clearProfileAvatar(): Promise<void> {
  assertNotDemo("profile:clearAvatar");
  await queue(async () => {
    await fs.rm(avatarPath(), { force: true });
  });
}
