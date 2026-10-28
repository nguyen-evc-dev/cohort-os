/**
 * Đọc file bảng (xlsx / csv) thành mảng dòng × cột (chuỗi). Dùng cho report xuất từ Meta Ads Manager.
 * Chạy được trong trình duyệt và Node (không dùng DOM, không dùng Buffer). Chỉ đọc, không chạy công thức / macro.
 */
import { unzipSync, strFromU8 } from 'fflate';

const MAX_UNZIPPED = 30 * 1024 * 1024; // chặn "zip bomb"
const MAX_ROWS = 100_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s: string): string => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? _;
});
const textOf = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');
const colIndex = (ref: string): number => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Dòng đầu tiên của sheet đầu tiên trong file .xlsx. */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.originalSize <= MAX_UNZIPPED && /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name) });
  } catch { throw new Error('Không đọc được file Excel (file hỏng hoặc không phải .xlsx).'); }
  const sheetName = Object.keys(files).filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10))[0];
  if (!sheetName) throw new Error('File Excel không có sheet nào.');
  const shared = files['xl/sharedStrings.xml']
    ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];
  const sheet = strFromU8(files[sheetName]);
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const body = cm[2] ?? '';
      let value = '';
      if (type === 'inlineStr') value = textOf(body);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined) value = type === 's' ? (shared[Number(v)] ?? '') : decodeXml(v);
      }
      cells[colIndex(ref)] = value;
    }
    rows.push(Array.from(cells, (c) => c ?? ''));
    if (rows.length > MAX_ROWS) throw new Error(`File quá lớn (hơn ${MAX_ROWS} dòng).`);
  }
  return rows;
}

/** CSV chuẩn RFC 4180 (dấu phẩy, ô có ngoặc kép, xuống dòng trong ô). Bỏ BOM. */
export function readCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS) throw new Error(`File quá lớn (hơn ${MAX_ROWS} dòng).`);
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** Đọc theo đuôi file: .xlsx hoặc .csv. */
export function readTable(bytes: Uint8Array, fileName: string): string[][] {
  const name = fileName.toLowerCase();
  if (name.endsWith('.xlsx')) return readXlsx(bytes);
  if (name.endsWith('.csv')) return readCsv(new TextDecoder('utf-8').decode(bytes));
  throw new Error('Chỉ nhận file .xlsx hoặc .csv xuất từ Ads Manager.');
}
