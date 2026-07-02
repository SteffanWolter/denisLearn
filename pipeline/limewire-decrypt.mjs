import { webcrypto } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const crypto = webcrypto;
const root = process.cwd();

function b64buf(value) {
  return Buffer.from(value, "base64");
}

function b64url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function aesCtrCounter(iv, counter) {
  if (iv.byteLength !== 11) throw new Error("IV must be 11 bytes");
  const output = new ArrayBuffer(16);
  const bytes = new Uint8Array(output);
  bytes.set(new Uint8Array(iv), 0);
  const view = new DataView(output, 11, 5);
  view.setUint32(0, Math.floor(counter / 256), false);
  view.setUint8(4, counter % 256);
  return output;
}

async function deriveKey({ passphrase, saltBase64, wrappedPrivateKeyBase64, publicKeyBase64, ephemeralPublicKeyBase64 }) {
  const passKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), { name: "PBKDF2" }, false, [
    "deriveBits",
    "deriveKey"
  ]);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", iterations: 100000, hash: "SHA-256", salt: b64buf(saltBase64) },
    passKey,
    { name: "AES-KW", length: 256 },
    true,
    ["wrapKey", "unwrapKey"]
  );
  const rawPrivateKey = await crypto.subtle.unwrapKey(
    "raw",
    b64buf(wrappedPrivateKeyBase64),
    wrappingKey,
    "AES-KW",
    { name: "AES-CTR" },
    true,
    ["wrapKey"]
  );
  const privateRaw = await crypto.subtle.exportKey("raw", rawPrivateKey);
  const publicKey = await crypto.subtle.importKey("raw", b64buf(publicKeyBase64), { name: "ECDH", namedCurve: "P-256" }, true, []);
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  jwk.d = b64url(privateRaw);
  jwk.key_ops = ["deriveBits", "deriveKey"];
  const privateEcdh = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
    "deriveKey"
  ]);
  const ephemeral = await crypto.subtle.importKey(
    "raw",
    b64buf(ephemeralPublicKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: ephemeral },
    privateEcdh,
    { name: "AES-CTR", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function decryptLimewireFile(options) {
  const aesCtrKey = await deriveKey(options);
  const encrypted = new Uint8Array(await (await fetch(options.downloadUrl)).arrayBuffer());
  const iv = b64buf(options.mainFileIvBase64);
  const blockLength = Math.floor(encrypted.byteLength / 16) * 16;
  const chunks = [];
  let counter = 0;

  if (blockLength) {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-CTR", counter: aesCtrCounter(iv, counter), length: 40 },
      aesCtrKey,
      encrypted.slice(0, blockLength)
    );
    chunks.push(Buffer.from(decrypted));
    counter += Math.ceil(blockLength / 16);
  }

  if (encrypted.byteLength > blockLength) {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-CTR", counter: aesCtrCounter(iv, counter), length: 40 },
      aesCtrKey,
      encrypted.slice(blockLength)
    );
    chunks.push(Buffer.from(decrypted));
  }

  const output = Buffer.concat(chunks);
  await fs.writeFile(options.outputPath, output);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configPath = process.argv[2] || path.join(root, "pipeline", "limewire-download.config.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const output = await decryptLimewireFile(config);
  console.log(`Wrote ${config.outputPath} (${output.length} bytes)`);
}
