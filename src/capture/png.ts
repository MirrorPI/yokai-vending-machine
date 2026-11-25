import type { Raster } from './scene.ts';

/** Exact source samples for our approved non-interlaced RGBA8 PNGs. Canvas
 * readback premultiplies/unpremultiplies translucent RGB and loses low bits.
 * Caller authenticates the complete PNG against its catalog SHA256 first.
 * Filter rules: https://www.w3.org/TR/png/#9Filtering */
export async function decodeRgbaPng(bytes: Uint8Array, expectedSize: readonly number[]): Promise<Raster> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((v, i) => bytes[i] !== v)) throw new Error('Invalid PNG signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, ended = false, total = 0;
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at), end = at + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG chunk');
    const kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (at === 8 && kind !== 'IHDR') throw new Error('Missing PNG header');
    if (kind === 'IHDR') {
      if (at !== 8 || length !== 13) throw new Error('Invalid PNG header');
      width = view.getUint32(at + 8); height = view.getUint32(at + 12);
      if (!width || !height || width !== expectedSize[0] || height !== expectedSize[1]
        || width * height > 16_777_216 || bytes[at + 16] !== 8 || bytes[at + 17] !== 6
        || bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || bytes[at + 20] !== 0) throw new Error('Unsupported PNG encoding or dimensions');
    } else if (kind === 'IDAT') {
      parts.push(bytes.slice(at + 8, at + 8 + length)); total += length;
    } else if (kind === 'IEND') { ended = length === 0; break; }
    at = end;
  }
  if (!width || !ended || !total) throw new Error('Incomplete PNG');
  const compressed = new Uint8Array(total); let offset = 0;
  for (const part of parts) { compressed.set(part, offset); offset += part.length; }
  const stride = width * 4, filtered = new Uint8Array((stride + 1) * height);
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      if (offset + value.length > filtered.length) throw new Error('PNG scanlines exceed dimensions');
      filtered.set(value, offset); offset += value.length;
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  if (offset !== filtered.length) throw new Error('Truncated PNG scanlines');
  const data = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride, source = y * (stride + 1), filter = filtered[source];
    if (filter > 4) throw new Error('Invalid PNG row filter');
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? data[row + x - 4] : 0;
      const up = y ? data[row + x - stride] : 0;
      const upperLeft = y && x >= 4 ? data[row + x - stride - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      // PNG filters use modulo arithmetic, not Uint8ClampedArray saturation.
      data[row + x] = (filtered[source + x + 1] + predictor) & 255;
    }
  }
  return { width, height, data };
}
