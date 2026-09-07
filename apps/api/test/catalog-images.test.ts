import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { compressCatalogImage } from "../src/catalog-images.js";

test("normalizes catalogue images to a compressed square WebP", async () => {
  const source = Buffer.from('<svg width="400" height="250" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="250" fill="#e11d48"/></svg>');
  const output = await compressCatalogImage(source);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1000);
  assert.equal(metadata.height, 1000);
  assert.ok(output.length > 0);
});

test("rejects catalogue images too small for Meta", async () => {
  const source = Buffer.from('<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#fff"/></svg>');
  await assert.rejects(() => compressCatalogImage(source), /at least 150/);
});
