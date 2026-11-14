import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MAX_IMAGE_BYTES = 1_000_000;
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = 8_000_000;

const invalid = () => { throw new Error('Image must be a valid, bounded PNG or JPEG.'); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(data, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngSize(data) {
  if (data.length < 45 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) invalid();
  let offset = 8, width, height, imageData = false, ended = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    if (length > data.length - offset - 12) invalid();
    const type = data.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) invalid();
    if (crc32(data, offset + 4, offset + 8 + length) !== data.readUInt32BE(offset + 8 + length)) invalid();
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) invalid();
      width = data.readUInt32BE(offset + 8);
      height = data.readUInt32BE(offset + 12);
      if (![[1, 0], [2, 0], [4, 0], [8, 0], [16, 0], [8, 2], [16, 2],
        [1, 3], [2, 3], [4, 3], [8, 3], [8, 4], [16, 4], [8, 6], [16, 6]]
        .some(([depth, color]) => data[offset + 16] === depth && data[offset + 17] === color)
        || data[offset + 18] !== 0 || data[offset + 19] !== 0 || data[offset + 20] > 1) invalid();
    } else if (type === 'IHDR') invalid();
    if (type === 'IDAT' && length) imageData = true;
    offset += length + 12;
    if (type === 'IEND') {
      if (length !== 0 || offset !== data.length || !imageData) invalid();
      ended = true;
      break;
    }
  }
  if (!ended) invalid();
  return { width, height };
}

function jpegSize(data) {
  if (data.length < 16 || data[0] !== 0xff || data[1] !== 0xd8
      || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) invalid();
  let offset = 2, width, height, scan = false;
  while (offset < data.length - 2) {
    if (data[offset++] !== 0xff) invalid();
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xda) {
      if (offset + 2 > data.length - 2 || data.readUInt16BE(offset) < 6
          || offset + data.readUInt16BE(offset) > data.length - 2) invalid();
      scan = true;
      break;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0 || marker === 1
        || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > data.length - 2) invalid();
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length - 2) invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (width !== undefined || length < 11) invalid();
      height = data.readUInt16BE(offset + 3);
      width = data.readUInt16BE(offset + 5);
      const components = data[offset + 7];
      if (!components || length !== 8 + 3 * components) invalid();
    }
    offset += length;
  }
  if (!scan || width === undefined) invalid();
  return { width, height };
}

/**
 * Validate one browser-provided image. This checks container structure and
 * dimensions, not a full decode or metadata removal. Do not log the return value.
 */
export function validatePlanningImage(image, imageConsent) {
  if (image === undefined) {
    if (imageConsent !== undefined && imageConsent !== false) throw new Error('Image consent requires an image.');
    return undefined;
  }
  if (imageConsent !== true) throw new Error('Explicit image consent is required.');
  if (!isObject(image) || Object.keys(image).some(key => !['mimeType', 'data'].includes(key))
      || !['image/png', 'image/jpeg'].includes(image.mimeType) || typeof image.data !== 'string'
      || !image.data.length || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data))
    invalid();
  const bytes = Buffer.from(image.data, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== image.data) invalid();
  const { width, height } = image.mimeType === 'image/png' ? pngSize(bytes) : jpegSize(bytes);
  if (!width || !height || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
      || width * height > MAX_IMAGE_PIXELS) invalid();
  return { mimeType: image.mimeType, data: image.data, bytes, width, height };
}

/**
 * The callback must not resolve until the CLI and its descendants have stopped
 * using the file, including on cancellation. Mode bits do not establish Windows
 * ACLs; the server must run under a trusted account with a private temp directory.
 */
export async function withCopilotImageAttachment({ image, imageConsent, signal }, run) {
  if (typeof run !== 'function' || (signal !== undefined && !(signal instanceof AbortSignal)))
    throw new Error('Image attachment request is invalid.');
  const validated = validatePlanningImage(image, imageConsent);
  if (!validated) return run(undefined);
  if (signal?.aborted) throw new Error('Image planning was cancelled.');
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), 'bricklab-image-'));
    const file = join(dir, validated.mimeType === 'image/png' ? 'image.png' : 'image.jpg');
    await writeFile(file, validated.bytes, { flag: 'wx', mode: 0o600, signal });
    if (signal?.aborted) throw new Error('Image planning was cancelled.');
    return await run(file);
  } catch (error) {
    if (signal?.aborted) throw new Error('Image planning was cancelled.');
    throw error;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
