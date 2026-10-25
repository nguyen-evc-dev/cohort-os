/**
 * Tách thông tin từ tên ad / adset / campaign.
 *
 * Quy ước thực tế của tài khoản EVC (kiểm tra 24/10/2026):
 *   "<Photo|Video> <Concept>_<Tệp đối tượng>_<...>"
 *   "Photo Agenda_WARM_Engaged+Follower+Watched_Photo"  → photo / concept "Photo Agenda"
 *   "Video ban doc_WARM_Engaged+Follower+Watched_MOF"   → video / MOFU / "Video ban doc"
 * Tên không có "_" (quy ước cũ): stage được xóa khỏi concept ("Photo MOFU Agenda" → "Photo Agenda").
 * Stage chấp nhận cả dạng viết tắt TOF/MOF/BOF, ở bất kỳ vị trí nào.
 */

export type Stage = 'TOFU' | 'MOFU' | 'BOFU';
export interface ParsedAdName {
  format: 'photo' | 'video' | null;
  stage: Stage | null;
  concept: string;
  conceptKey: string;
  parsed: boolean;
}

const STAGE_RE = /(?<![A-Za-z0-9])(TOFU?|MOFU?|BOFU?)(?![A-Za-z0-9])/i;
const STAGE_STRIP_RE = /[\s\-_|]*[[(]?(?<![A-Za-z0-9])(TOFU?|MOFU?|BOFU?)(?![A-Za-z0-9])[\])]?[\s\-_|]*/gi;
const COPY_SUFFIX_RE = /\s*[-–—]\s*(copy|bản sao)(\s*\d+)?\s*$/i;
const FORMATS: Record<string, 'photo' | 'video'> = { photo: 'photo', video: 'video' };

/** Bỏ các hậu tố Meta tự thêm khi nhân bản ad, kể cả lặp nhiều lần. */
export function stripCopySuffix(name: string | null | undefined): string {
  let s = String(name || '').trim();
  while (COPY_SUFFIX_RE.test(s)) s = s.replace(COPY_SUFFIX_RE, '').trim();
  return s;
}

export function detectStage(name: string | null | undefined): Stage | null {
  const m = String(name || '').match(STAGE_RE);
  if (!m) return null;
  const s = m[1].toUpperCase();
  return (s.length === 3 ? s + 'U' : s) as Stage;
}

/** Khóa so khớp concept: lowercase, gộp khoảng trắng. */
export function conceptKey(concept: string | null | undefined): string {
  return String(concept || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function parseAdName(name: string | null | undefined): ParsedAdName {
  const base = stripCopySuffix(name);
  const stage = detectStage(base);
  const underscore = base.indexOf('_');
  const withoutStage = underscore > 0
    ? base.slice(0, underscore).replace(/\s+/g, ' ').trim()
    : base.replace(STAGE_STRIP_RE, ' ').replace(/\s+/g, ' ').trim();
  const words = withoutStage.split(' ');
  const format = FORMATS[(words[0] || '').toLowerCase()] || null;
  const rest = words.slice(1).join(' ').trim();
  if (!format || !rest) return { format, stage, concept: 'UNPARSED', conceptKey: 'unparsed', parsed: false };
  return { format, stage, concept: withoutStage, conceptKey: conceptKey(withoutStage), parsed: true };
}

/** Stage của 1 ad: tên ad → tên adset → tên campaign → cấu hình theo campaign → null. */
export function resolveStage(
  adName: string | null | undefined, adsetName: string | null | undefined,
  campaignName: string | null | undefined, configStage?: string | null,
): Stage | null {
  return detectStage(stripCopySuffix(adName)) || detectStage(adsetName) || detectStage(campaignName)
    || (configStage ? (String(configStage).toUpperCase() as Stage) : null);
}

/** Campaign là Special Ad Category thật khi tên có token "SAC" đứng riêng (vd COACH-WBN-RE-PC-SAC). */
export function isSacCampaign(name: string | null | undefined): boolean {
  return /(?<![A-Za-z0-9])SAC(?![A-Za-z0-9])/i.test(String(name || ''));
}
