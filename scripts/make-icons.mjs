// 개발용 1회 실행: 단색 PNG 아이콘 생성 (외부 의존성 없음).
// 사용: node scripts/make-icons.mjs  → icons/icon-192.png, icon-512.png, apple-touch-icon.png
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
// 웜 페이퍼 배경 + 중앙 액센트 사각형 (수직/수평 40~60% 영역)
function makePng(size, path) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const paper = [0xf6, 0xf3, 0xec], acc = [0x8c, 0x1a, 0x12];
  const lo = Math.floor(size * 0.4), hi = Math.floor(size * 0.6);
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const c = y >= lo && y < hi && x >= lo && x < hi ? acc : paper;
      raw.set(c, row + 1 + x * 3);
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log(path, png.length, 'bytes');
}
mkdirSync('icons', { recursive: true });
makePng(192, 'icons/icon-192.png');
makePng(512, 'icons/icon-512.png');
makePng(180, 'icons/apple-touch-icon.png');
