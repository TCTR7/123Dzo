// Original repo-owned geometric mug icon and two-tone chime; no external media.
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const [name, size] of [['icon-192x192.png', 192], ['icon-512x512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(resolve(root, 'public/icon.svg')).resize(size, size).png().toFile(resolve(root, 'public', name));
}
const rate = 22050, count = Math.floor(rate * 0.72), wav = Buffer.alloc(44 + count * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
for (let n = 0; n < count; n++) {
  const t = n / rate; let value = 0;
  for (const [start, frequency] of [[0.02, 880], [0.28, 1174.66]]) {
    const dt = t - start;
    if (dt >= 0 && dt < 0.4) value += 0.28 * Math.exp(-dt * 9) * Math.min(1, dt / 0.008) * Math.sin(2 * Math.PI * frequency * dt);
  }
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + n * 2);
}
await writeFile(resolve(root, 'public/sounds/ting-ting.wav'), wav);
