/**
 * Mục tiêu của Project = chuỗi chuyển đổi do staff khai báo khi tạo Project.
 * Không phải campaign nào cũng đo bằng Lead / ROAS: mỗi Project chọn đúng custom conversion trong Meta
 * và bước cuối trong CRM (deal stage / loại deal) mang giá trị thật.
 *
 * Ví dụ Webinar RE11:  Check Out (Meta) → Purchased (Meta) → Seat (CRM) → Khóa học $1,750 (CRM, bước cuối)
 * Ví dụ Event SJ 10.24: Đăng ký (Meta)  → Lead CRM → Buyer showing (CRM stage) → Escrow (CRM stage, bước cuối)
 */

export type StepSource = 'meta' | 'crm';
export type CrmKind = 'registrations' | 'seats' | 'programs' | 'stages';

export interface GoalStep {
  key: string;
  label: string;
  source: StepSource;
  /** meta: action_type trong meta_actions_daily (vd offsite_conversion.custom.2050096562303283) hoặc cột có sẵn (col.leads_meta, col.purchases_meta) */
  action_type?: string;
  /** crm: loại đếm */
  crm?: CrmKind;
  /** crm = stages: tên Deal Stage trong HubSpot (khớp không phân biệt hoa thường). Bước sau gồm cả deal đã đi xa hơn. */
  stages?: string[];
  /** Giá trị cố định mỗi chuyển đổi (vd 1750). Bỏ trống: CRM dùng Amount của deal, Meta = 0. */
  value?: number | null;
}

export interface ProjectGoal {
  focus: string;
  template: string;
  steps: GoalStep[];
  /** Bước đo CPA / CPL chính */
  primary: string;
  /** Bước cuối mang giá trị thật */
  final: string;
  /** Truth Gap: bước Meta so với bước CRM */
  compare: { meta: string; crm: string } | null;
  /** Target chi phí trên bước chính (tùy chọn) */
  target_cost: number | null;
}

export const MAX_STEPS = 6;
const KEY_RE = /^[a-z0-9_]{1,30}$/;
const ACTION_RE = /^[a-z0-9_.]{2,80}$/;
const CRM_KINDS = new Set<CrmKind>(['registrations', 'seats', 'programs', 'stages']);

export const customConversionAction = (id: string) => `offsite_conversion.custom.${id}`;
export const STANDARD_ACTIONS: { action_type: string; label: string }[] = [
  { action_type: 'offsite_conversion.fb_pixel_purchase', label: 'Purchase (pixel)' },
  { action_type: 'offsite_conversion.fb_pixel_initiate_checkout', label: 'Initiate checkout (pixel)' },
  { action_type: 'offsite_conversion.fb_pixel_lead', label: 'Lead (pixel)' },
  { action_type: 'offsite_conversion.fb_pixel_complete_registration', label: 'Complete registration (pixel)' },
  { action_type: 'col.leads_meta', label: 'Lead (Meta, gồm lead form)' },
  { action_type: 'col.purchases_meta', label: 'Purchase (Meta, mọi nguồn)' },
];

/** Mục tiêu mặc định khi Project chưa khai báo (giữ cách đo cũ: Lead + Purchase Meta, rồi đăng ký / seat / program CRM). */
export function defaultGoal(): ProjectGoal {
  return {
    focus: '', template: 'default',
    steps: [
      { key: 'lead', label: 'Lead (Meta)', source: 'meta', action_type: 'col.leads_meta' },
      { key: 'purchase', label: 'Purchase (Meta)', source: 'meta', action_type: 'col.purchases_meta' },
      { key: 'registrations', label: 'Đăng ký (CRM)', source: 'crm', crm: 'registrations' },
      { key: 'seats', label: 'Seat (CRM)', source: 'crm', crm: 'seats' },
      { key: 'programs', label: 'Program (CRM)', source: 'crm', crm: 'programs' },
    ],
    primary: 'purchase', final: 'programs', compare: { meta: 'purchase', crm: 'seats' }, target_cost: null,
  };
}

/** Mẫu gợi ý khi tạo Project. ID custom conversion điền sau (hoặc chọn từ danh mục). */
export const GOAL_TEMPLATES: Record<string, { name: string; hint: string; goal: ProjectGoal }> = {
  webinar: {
    name: 'Webinar (đăng ký → mua vé → mua khóa học)',
    hint: 'Webinar chỉ là bước đầu; giá trị thật là khóa học chốt trong webinar.',
    goal: {
      focus: 'Bán vé webinar, chốt khóa học trong buổi webinar', template: 'webinar',
      steps: [
        { key: 'checkout', label: 'Check Out (điền form)', source: 'meta', action_type: '' },
        { key: 'purchased', label: 'Purchased (mua vé)', source: 'meta', action_type: '' },
        { key: 'seat', label: 'Seat (CRM)', source: 'crm', crm: 'seats' },
        { key: 'program', label: 'Mua khóa học', source: 'crm', crm: 'programs', value: null },
      ],
      primary: 'purchased', final: 'program', compare: { meta: 'purchased', crm: 'seat' }, target_cost: null,
    },
  },
  event: {
    name: 'Event (đăng ký → buyer showing → escrow)',
    hint: 'Event chỉ là bước đầu; giá trị thật là khách đi xem nhà và vào escrow.',
    goal: {
      focus: 'Đăng ký event, chuyển thành buyer showing và escrow', template: 'event',
      steps: [
        { key: 'register', label: 'Đăng ký event', source: 'meta', action_type: '' },
        { key: 'lead', label: 'Lead (CRM)', source: 'crm', crm: 'registrations' },
        { key: 'showing', label: 'Buyer showing', source: 'crm', crm: 'stages', stages: ['Buyer Showing'] },
        { key: 'escrow', label: 'Escrow', source: 'crm', crm: 'stages', stages: ['Escrow'], value: null },
      ],
      primary: 'register', final: 'escrow', compare: null, target_cost: null,
    },
  },
  lead: {
    name: 'Lead (form → CRM)',
    hint: 'Đo chi phí trên mỗi lead đăng ký thật.',
    goal: {
      focus: 'Thu lead', template: 'lead',
      steps: [
        { key: 'lead_meta', label: 'Lead (Meta)', source: 'meta', action_type: '' },
        { key: 'lead_crm', label: 'Lead (CRM)', source: 'crm', crm: 'registrations' },
      ],
      primary: 'lead_meta', final: 'lead_crm', compare: { meta: 'lead_meta', crm: 'lead_crm' }, target_cost: null,
    },
  },
};

const fail = (m: string): never => { throw new Error(m); };

/** Kiểm tra + chuẩn hóa mục tiêu (dùng ở server action trước khi lưu). Ném Error tiếng Việt nếu sai. */
export function parseGoal(raw: unknown): ProjectGoal {
  if (!raw || typeof raw !== 'object') fail('Mục tiêu trống.');
  const g = raw as Record<string, any>;
  const steps: GoalStep[] = (Array.isArray(g.steps) ? g.steps : []).map((s: Record<string, any>, i: number) => {
    const at = `Bước ${i + 1}`;
    const key = String(s?.key ?? '').trim();
    const label = String(s?.label ?? '').trim();
    if (!KEY_RE.test(key)) fail(`${at}: mã bước chỉ gồm a–z, 0–9, gạch dưới.`);
    if (!label || label.length > 60 || label.includes('@')) fail(`${at}: tên bước phải có 1–60 ký tự.`);
    const value = s.value === '' || s.value === undefined || s.value === null ? null : Number(s.value);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1e7)) fail(`${at}: giá trị không hợp lệ.`);
    if (s.source === 'meta') {
      const a = String(s.action_type ?? '').trim();
      if (!ACTION_RE.test(a)) fail(`${at} (${label}): chưa chọn custom conversion / sự kiện Meta.`);
      return { key, label, source: 'meta', action_type: a, value };
    }
    if (s.source === 'crm') {
      if (!CRM_KINDS.has(s.crm)) fail(`${at} (${label}): loại CRM không hợp lệ.`);
      const stages = s.crm === 'stages'
        ? (Array.isArray(s.stages) ? s.stages : String(s.stages ?? '').split(',')).map((x: unknown) => String(x).trim()).filter(Boolean)
        : undefined;
      if (stages && (stages.length === 0 || stages.length > 10 || stages.some((x: string) => x.length > 60 || x.includes('@')))) {
        fail(`${at} (${label}): nhập 1–10 tên Deal Stage, cách nhau bằng dấu phẩy.`);
      }
      return { key, label, source: 'crm', crm: s.crm, ...(stages ? { stages } : {}), value };
    }
    return fail(`${at}: nguồn phải là Meta hoặc CRM.`);
  });
  if (steps.length < 1 || steps.length > MAX_STEPS) fail(`Cần 1–${MAX_STEPS} bước.`);
  const keys = new Set<string>();
  for (const s of steps) { if (keys.has(s.key)) fail(`Mã bước "${s.key}" bị trùng.`); keys.add(s.key); }
  const primary = String(g.primary ?? '');
  const final = String(g.final ?? '');
  if (!keys.has(primary)) fail('Chưa chọn bước chính (đo CPA / CPL).');
  if (!keys.has(final)) fail('Chưa chọn bước cuối (giá trị thật).');
  let compare: ProjectGoal['compare'] = null;
  if (g.compare && g.compare.meta && g.compare.crm) {
    const m = steps.find((s) => s.key === g.compare.meta);
    const c = steps.find((s) => s.key === g.compare.crm);
    if (!m || m.source !== 'meta' || !c || c.source !== 'crm') fail('Truth Gap phải so 1 bước Meta với 1 bước CRM.');
    compare = { meta: g.compare.meta, crm: g.compare.crm };
  }
  const tc = g.target_cost === '' || g.target_cost === undefined || g.target_cost === null ? null : Number(g.target_cost);
  if (tc !== null && (!Number.isFinite(tc) || tc <= 0 || tc > 1e6)) fail('Target chi phí không hợp lệ.');
  const focus = String(g.focus ?? '').trim().slice(0, 300);
  if (focus.includes('@')) fail('Trọng tâm không được chứa email.');
  return { focus, template: String(g.template ?? 'custom').slice(0, 30), steps, primary, final, compare, target_cost: tc };
}

/** Đọc mục tiêu đã lưu; sai / trống → null (dùng mặc định). */
export function readGoal(raw: unknown): ProjectGoal | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).steps)) return null;
  try { return parseGoal(raw); } catch { return null; }
}

/** Mọi action_type Meta mà các mục tiêu đang dùng (để sync biết cần giữ loại nào). */
export function goalActionTypes(goals: (ProjectGoal | null)[]): string[] {
  return [...new Set(goals.flatMap((g) => (g?.steps ?? []).filter((s) => s.source === 'meta' && s.action_type && !s.action_type.startsWith('col.')).map((s) => s.action_type!)))];
}
