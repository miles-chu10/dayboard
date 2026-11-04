const encoder = new TextEncoder();

export function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64Url(data);
}

function toBase64Url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const data = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
  return data;
}

export async function hash(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

/**
 * Compares two strings without revealing where they differ: both sides are HMACed with a fresh
 * random key, so the byte loop always runs over two 32-byte digests whatever the input lengths.
 */
export async function safeEqual(provided: string, expected: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const [a, b] = await Promise.all(
    [provided, expected].map(
      async (value) => new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))),
    ),
  );
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

/** A new license: its row ID, the random 256-bit key, the key's lookup HMAC and its sealed copy. */
export async function mintLicense(encryptionKey: string, hashSecret: string) {
  const key = `DAYB_${randomToken()}`;
  const sealed = await encrypt(key, encryptionKey);
  const keyHash = await hash(key, hashSecret);
  const licenseId = randomToken(24);
  return { licenseId, key, keyHash, sealed };
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const bytes = fromBase64Url(secret);
  if (bytes.byteLength !== 32) throw new Error("invalid encryption key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(
  value: string,
  secret: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(secret),
    encoder.encode(value),
  );
  return { ciphertext: toBase64Url(new Uint8Array(ciphertext)), iv: toBase64Url(iv) };
}

export async function decrypt(ciphertext: string, iv: string, secret: string): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(iv) },
    await aesKey(secret),
    fromBase64Url(ciphertext),
  );
  return new TextDecoder().decode(plain);
}
