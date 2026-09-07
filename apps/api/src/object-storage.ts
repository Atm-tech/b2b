import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";

const accountId = process.env.R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
const bucketName = process.env.R2_BUCKET_NAME?.trim();
const objectPrefix = (process.env.R2_OBJECT_PREFIX || "proofs").trim().replace(/^\/+|\/+$/g, "");

const r2CredentialsStarted = Boolean(accountId || accessKeyId || secretAccessKey);
if (r2CredentialsStarted && !(accountId && accessKeyId && secretAccessKey && bucketName)) {
  throw new Error("Incomplete Cloudflare R2 configuration. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME together.");
}

export const r2Enabled = Boolean(accountId && accessKeyId && secretAccessKey && bucketName);

const client = r2Enabled
  ? new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! }
    })
  : null;

export type ProofCategory = "payment-proofs" | "delivery-proofs" | "receipt-proofs" | "return-proofs";
type ObjectCategory = ProofCategory | "catalog-images";

function safeFileName(originalName: string) {
  const normalized = originalName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return normalized.slice(-100) || "proof";
}

function objectKey(category: ObjectCategory, fileName: string) {
  return [objectPrefix, category, fileName].filter(Boolean).join("/");
}

export async function putCatalogImageObject(sku: string, body: Buffer, sourceUrl: string) {
  if (!client || !bucketName) throw new Error("Cloudflare R2 is not configured.");
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const fileName = `${safeFileName(sku)}-${digest}.webp`;
  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey("catalog-images", fileName),
    Body: body,
    ContentType: "image/webp",
    ContentLength: body.length,
    CacheControl: "public, max-age=31536000, immutable",
    Metadata: { "source-url": encodeURIComponent(sourceUrl).slice(0, 900) }
  }));
  return fileName;
}

export async function getCatalogImageObject(fileName: string) {
  if (!client || !bucketName) throw new Error("Cloudflare R2 is not configured.");
  const result = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: objectKey("catalog-images", safeFileName(fileName)) }));
  if (!result.Body) throw new Error("Stored catalogue image has no content.");
  return {
    body: Buffer.from(await result.Body.transformToByteArray()),
    contentType: result.ContentType || "image/webp",
    contentLength: result.ContentLength,
    etag: result.ETag
  };
}

export async function putProofObject(category: ProofCategory, file: Express.Multer.File) {
  if (!client || !bucketName) {
    throw new Error("Cloudflare R2 is not configured.");
  }

  const fileName = `${randomUUID()}-${safeFileName(file.originalname)}`;
  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey(category, fileName),
    Body: file.buffer,
    ContentType: file.mimetype || "application/octet-stream",
    ContentLength: file.size,
    Metadata: {
      "original-name": encodeURIComponent(file.originalname).slice(0, 900)
    }
  }));
  return fileName;
}

export async function getProofObject(category: ProofCategory, fileName: string) {
  if (!client || !bucketName) {
    throw new Error("Cloudflare R2 is not configured.");
  }

  const result = await client.send(new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey(category, fileName)
  }));
  if (!result.Body) {
    throw new Error("Stored proof has no content.");
  }
  const bytes = await result.Body.transformToByteArray();
  return {
    body: Buffer.from(bytes),
    contentType: result.ContentType || "application/octet-stream",
    contentLength: result.ContentLength,
    etag: result.ETag
  };
}
