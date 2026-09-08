import { deflateSync } from "node:zlib";

// Small deterministic raster covers for UI tests, with no downloaded/private art.
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
}
export function syntheticCourseImage(
  id: number,
  width = 320,
  height = 192,
): Buffer {
  const palette = [
    [217, 204, 170],
    [105, 148, 158],
    [158, 177, 137],
  ][id % 3];
  const pixels = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * (width * 3 + 1) + 1 + x * 3;
      const wave = Math.sin(x / 48 + id) * 28 + 95;
      const circle = (x - 240) ** 2 + (y - 48) ** 2 < 28 ** 2;
      const shade = circle ? 1.18 : y > wave ? 0.68 : 1;
      for (let channel = 0; channel < 3; channel++)
        pixels[index + channel] = Math.min(
          255,
          Math.round(palette[channel] * shade),
        );
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
