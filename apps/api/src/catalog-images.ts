import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  if (isIP(normalized) !== 4) return false;
  const parts = normalized.split(".").map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

async function validatedRemoteUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a valid HTTPS image URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Only standard HTTPS image URLs are allowed.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Private or local image hosts are not allowed.");
  return url;
}

async function download(urlValue: string, redirects = 0): Promise<{ body: Buffer; sourceUrl: string }> {
  const url = await validatedRemoteUrl(urlValue);
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "Aapoorti-Catalogue/1.0 (product image importer)" }
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location || redirects >= MAX_REDIRECTS) throw new Error("Image URL redirected too many times.");
    return download(new URL(location, url).toString(), redirects + 1);
  }
  if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}.`);
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/") || contentType === "image/svg+xml") throw new Error("The URL must return a raster image.");
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_SOURCE_BYTES) throw new Error("Source image is larger than 8 MB.");
  if (!response.body) throw new Error("Source image response was empty.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error("Source image is larger than 8 MB.");
    }
    chunks.push(Buffer.from(value));
  }
  const body = Buffer.concat(chunks, bytes);
  if (!body.length) throw new Error("Source image is empty.");
  return { body, sourceUrl: url.toString() };
}

export async function compressCatalogImage(input: Buffer) {
  const image = sharp(input, { failOn: "warning", limitInputPixels: 36_000_000, animated: false }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width < 150 || metadata.height < 150) throw new Error("Product image must be at least 150 × 150 pixels.");
  return image
    .resize(1000, 1000, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: "#ffffff" })
    .webp({ quality: 72, effort: 6, smartSubsample: true })
    .toBuffer();
}

export async function downloadAndCompressCatalogImage(sourceUrl: string) {
  const downloaded = await download(sourceUrl);
  const body = await compressCatalogImage(downloaded.body);
  return { ...downloaded, body, width: 1000, height: 1000, bytes: body.length, contentType: "image/webp" };
}
