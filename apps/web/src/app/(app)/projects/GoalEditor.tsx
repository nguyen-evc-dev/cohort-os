'use client';
import { useActionState, useMemo, useState } from 'react';
import { customConversionAction, GOAL_TEMPLATES, MAX_STEPS, STANDARD_ACTIONS, type GoalStep, type ProjectGoal } from '@cohort/core';
import { saveGoal, type GoalState } from './actions';

export interface CustomConversion { id: string; name: string; event_type: string | null; is_archived: boolean; last_fired_at: string | null }

const CRM_LABEL: Record<string, string> = {
  registrations: 'Đăng ký (lead trong HubSpot form)', seats: 'Seat đã mua (deal "Webinar")', programs: 'Program đã mua (deal ≥ $100, Purchased)', stages: 'Theo Deal Stage (nhập tên stage)',
};
const blankStep = (i: number): GoalStep => ({ key: `step${i + 1}`, label: '', source: 'meta', action_type: '' });
const slugKey = (label: string, i: number) => (label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || `step${i + 1}`);

/**
 * Khai báo mục tiêu Project: trọng tâm → các bước chuyển đổi (Meta custom conversion / CRM) → bước chính (CPA/CPL) → bước cuối (giá trị thật).
 * Mỗi câu hỏi đều có gợi ý, để staff tự trả lời "Project này đo bằng gì".
 */
export function GoalEditor({ projectId, initial, customs }: { projectId: string; initial: ProjectGoal | null; customs: CustomConversion[] }) {
  const [g, setG] = useState<ProjectGoal>(() => initial ?? { ...GOAL_TEMPLATES.webinar.goal, steps: GOAL_TEMPLATES.webinar.goal.steps.map((s) => ({ ...s })) });
  const [state, action, pending] = useActionState<GoalState, FormData>(saveGoal, { ok: false, message: '' });
  const active = useMemo(() => customs.filter((c) => !c.is_archived), [customs]);
  const archived = useMemo(() => customs.filter((c) => c.is_archived), [customs]);
  const knownActions = new Set([...customs.map((c) => customConversionAction(c.id)), ...STANDARD_ACTIONS.map((a) => a.action_type)]);

  const setStep = (i: number, patch: Partial<GoalStep>) => setG((cur) => ({ ...cur, steps: cur.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const applyTemplate = (k: string) => {
    const t = GOAL_TEMPLATES[k];
    if (t) setG({ ...t.goal, focus: g.focus || t.goal.focus, steps: t.goal.steps.map((s) => ({ ...s })) });
  };
  const move = (i: number, d: -1 | 1) => setG((cur) => {
    const steps = [...cur.steps]; const j = i + d; if (j < 0 || j >= steps.length) return cur;
    [steps[i], steps[j]] = [steps[j], steps[i]]; return { ...cur, steps };
  });
  const remove = (i: number) => setG((cur) => {
    const steps = cur.steps.filter((_, j) => j !== i);
    const keys = steps.map((s) => s.key);
    return { ...cur, steps, primary: keys.includes(cur.primary) ? cur.primary : keys[0] ?? '', final: keys.includes(cur.final) ? cur.final : keys[keys.length - 1] ?? '',
      compare: cur.compare && keys.includes(cur.compare.meta) && keys.includes(cur.compare.crm) ? cur.compare : null };
  });
  const metaSteps = g.steps.filter((s) => s.source === 'meta');
  const crmSteps = g.steps.filter((s) => s.source === 'crm');
  // Mã bước tự sinh từ tên, không trùng
  const payload = JSON.stringify({ ...g, steps: g.steps.map((s, i) => ({ ...s, key: s.key || slugKey(s.label, i) })) });

  return (
    <form action={action} id="goal" className="panel" style={{ marginTop: 12, borderColor: 'var(--border-strong)' }}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="goal" value={payload} />
      <h3 style={{ fontSize: 16, margin: '0 0 4px' }}>🎯 Mục tiêu của Project</h3>
      <p className="note" style={{ margin: '0 0 12px' }}>Không phải campaign nào cũng đo bằng Lead hay ROAS. Trả lời 4 câu dưới đây để báo cáo đo đúng thứ anh quan tâm.</p>

      <label htmlFor={`focus-${projectId}`}>1. Trọng tâm của Project là gì?</label>
      <input id={`focus-${projectId}`} value={g.focus} maxLength={300} onChange={(e) => setG({ ...g, focus: e.target.value })}
        placeholder="vd: Bán vé webinar $10, chốt khóa học $1,750 trong buổi webinar" />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <span className="note" style={{ margin: 0 }}>Dùng mẫu:</span>
        {Object.entries(GOAL_TEMPLATES).map(([k, t]) => (
          <button key={k} type="button" className="ghost" title={t.hint} onClick={() => applyTemplate(k)} style={{ margin: 0, width: 'auto', padding: '4px 10px', fontSize: 12 }}>{t.name}</button>
        ))}
      </div>

      <label style={{ marginTop: 16 }}>2. Các bước chuyển đổi (theo thứ tự, tối đa {MAX_STEPS})</label>
      <p className="note" style={{ margin: '0 0 8px' }}>
        Bước <b>Meta</b> = custom conversion đã tạo trong Events Manager (chọn đúng tên + ID). Bước <b>CRM</b> = số đếm từ HubSpot sau khi import.
        {customs.length === 0 && <> <span style={{ color: 'var(--warn)' }}>Danh mục custom conversion chưa có: sẽ tự về sau lần sync kế tiếp; trong lúc chờ có thể nhập ID tay.</span></>}
      </p>
      <div className="grid" style={{ gap: 10 }}>
        {g.steps.map((s, i) => {
          const custom = s.action_type?.startsWith('offsite_conversion.custom.') ? s.action_type.slice('offsite_conversion.custom.'.length) : '';
          const manual = s.source === 'meta' && !!s.action_type && !knownActions.has(s.action_type);
          return (
            <div key={i} className="panel" style={{ background: 'var(--surface-2)', padding: 12 }}>
              <div className="form-grid" style={{ gridTemplateColumns: 'minmax(160px, 1.2fr) 110px minmax(220px, 2fr) 130px' }}>
                <div><label htmlFor={`lb-${projectId}-${i}`}>Tên bước</label>
                  <input id={`lb-${projectId}-${i}`} value={s.label} maxLength={60} placeholder="vd: Check Out (điền form)" onChange={(e) => setStep(i, { label: e.target.value })} /></div>
                <div><label htmlFor={`sr-${projectId}-${i}`}>Nguồn</label>
                  <select id={`sr-${projectId}-${i}`} value={s.source} onChange={(e) => setStep(i, e.target.value === 'meta' ? { source: 'meta', action_type: '', crm: undefined, stages: undefined } : { source: 'crm', crm: 'registrations', action_type: undefined })}>
                    <option value="meta">Meta</option><option value="crm">CRM</option></select></div>
                {s.source === 'meta' ? (
                  <div><label htmlFor={`ac-${projectId}-${i}`}>Custom conversion / sự kiện Meta</label>
                    <select id={`ac-${projectId}-${i}`} value={manual ? '__manual' : s.action_type || ''} onChange={(e) => setStep(i, { action_type: e.target.value === '__manual' ? 'offsite_conversion.custom.' : e.target.value })}>
                      <option value="">— chọn —</option>
                      {active.length > 0 && <optgroup label="Custom conversion đang dùng">{active.map((c) => <option key={c.id} value={customConversionAction(c.id)}>{c.name} · {c.id}</option>)}</optgroup>}
                      <optgroup label="Sự kiện chuẩn">{STANDARD_ACTIONS.map((a) => <option key={a.action_type} value={a.action_type}>{a.label}</option>)}</optgroup>
                      {archived.length > 0 && <optgroup label="Đã lưu trữ">{archived.map((c) => <option key={c.id} value={customConversionAction(c.id)}>{c.name} · {c.id}</option>)}</optgroup>}
                      <option value="__manual">Nhập ID custom conversion…</option>
                    </select>
                    {(manual || s.action_type === 'offsite_conversion.custom.') && (
                      <input style={{ marginTop: 6 }} aria-label="ID custom conversion" inputMode="numeric" placeholder="vd: 2050096562303283" value={custom}
                        onChange={(e) => setStep(i, { action_type: `offsite_conversion.custom.${e.target.value.replace(/\D/g, '')}` })} />
                    )}
                  </div>
                ) : (
                  <div><label htmlFor={`ck-${projectId}-${i}`}>Đếm trong CRM</label>
                    <select id={`ck-${projectId}-${i}`} value={s.crm} onChange={(e) => setStep(i, { crm: e.target.value as GoalStep['crm'], stages: e.target.value === 'stages' ? s.stages ?? [] : undefined })}>
                      {Object.entries(CRM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    {s.crm === 'stages' && (
                      <input style={{ marginTop: 6 }} aria-label="Tên Deal Stage" placeholder="Tên Deal Stage đúng như HubSpot, cách nhau dấu phẩy: Buyer Showing" value={(s.stages ?? []).join(', ')}
                        onChange={(e) => setStep(i, { stages: e.target.value.split(',').map((x) => x.trim()) })} />
                    )}
                  </div>
                )}
                <div><label htmlFor={`vl-${projectId}-${i}`}>Giá trị / lượt ($)</label>
                  <input id={`vl-${projectId}-${i}`} type="number" min={0} step="any" placeholder={s.source === 'crm' ? 'trống = Amount deal' : 'tùy chọn'} value={s.value ?? ''}
                    onChange={(e) => setStep(i, { value: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', margin: 0, textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--text)' }}>
                  <input type="radio" name={`primary-${projectId}`} checked={g.primary === s.key} onChange={() => setG({ ...g, primary: s.key })} /> Bước chính (đo CPA / CPL)</label>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', margin: 0, textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--text)' }}>
                  <input type="radio" name={`final-${projectId}`} checked={g.final === s.key} onChange={() => setG({ ...g, final: s.key })} /> Bước cuối (giá trị thật)</label>
                <span style={{ flex: 1 }} />
                <button type="button" className="ghost" aria-label="Lên" onClick={() => move(i, -1)} style={{ margin: 0, width: 'auto', padding: '2px 8px' }}>↑</button>
                <button type="button" className="ghost" aria-label="Xuống" onClick={() => move(i, 1)} style={{ margin: 0, width: 'auto', padding: '2px 8px' }}>↓</button>
                {g.steps.length > 1 && <button type="button" className="ghost" onClick={() => remove(i)} style={{ margin: 0, width: 'auto', padding: '2px 8px', color: 'var(--burn)' }}>Xóa</button>}
              </div>
            </div>
          );
        })}
      </div>
      {g.steps.length < MAX_STEPS && (
        <button type="button" className="ghost" onClick={() => setG({ ...g, steps: [...g.steps, blankStep(g.steps.length)] })} style={{ width: 'auto', padding: '6px 14px' }}>+ Thêm bước</button>
      )}

      <div className="form-grid" style={{ marginTop: 16 }}>
        <div><label htmlFor={`cmp-${projectId}`}>3. Truth Gap: so bước Meta nào với bước CRM nào?</label>
          <select id={`cmp-${projectId}`} value={g.compare ? `${g.compare.meta}|${g.compare.crm}` : ''} onChange={(e) => { const [m, c] = e.target.value.split('|'); setG({ ...g, compare: m && c ? { meta: m, crm: c } : null }); }}>
            <option value="">Không so</option>
            {metaSteps.flatMap((m) => crmSteps.map((c) => <option key={`${m.key}|${c.key}`} value={`${m.key}|${c.key}`}>{m.label || m.key} (Meta) ↔ {c.label || c.key} (CRM)</option>))}
          </select></div>
        <div><label htmlFor={`tc-${projectId}`}>4. Target chi phí cho bước chính ($, tùy chọn)</label>
          <input id={`tc-${projectId}`} type="number" min={0} step="any" placeholder="vd: 40" value={g.target_cost ?? ''} onChange={(e) => setG({ ...g, target_cost: e.target.value === '' ? null : Number(e.target.value) })} /></div>
      </div>

      {state.message && <p className={state.ok ? 'ok' : 'err'} style={{ margin: '12px 0 0', fontSize: 13 }}>{state.message}</p>}
      <button type="submit" disabled={pending} style={{ width: 'auto', padding: '8px 18px' }}>{pending ? 'Đang lưu…' : 'Lưu mục tiêu'}</button>
    </form>
  );
}
