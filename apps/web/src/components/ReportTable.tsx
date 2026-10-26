'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Metrics, ReportNode } from '@cohort/core';
import { costLabel, DASH, fmtInt, fmtMoney, fmtRate, fmtRoas } from '@/lib/format';

export interface TableStep { key: string; label: string; source: 'meta' | 'crm'; count: number; available: boolean }
interface Props {
  tree: ReportNode[];
  total: Metrics;
  unattributed: Metrics & { leadIds: number };
  hasCrm: boolean;
  src: 'meta' | 'crm' | 'both';
  /** Các bước mục tiêu của Project (theo thứ tự) */
  steps: TableStep[];
  primaryKey: string;
  finalKey: string;
  /** Cặp so sánh Meta ↔ CRM (cột Δ) */
  compare: { meta: string; crm: string } | null;
  /** Chi phí mục tiêu (target hoặc trung bình Project) trên bước chính, để tô đỏ ad đốt tiền. */
  baselineCost: number | null;
  fileName: string;
  /** Nhớ mẫu xem đã chọn theo Project */
  storageKey: string;
  allowExport?: boolean;
}

type Key = string; // 'name' | 'spend' | ... | 'step:<key>' | 'cost:<key>' | 'value:<key>'
type Group = 'meta' | 'crm' | 'delta';
interface Col { id: Key; label: string; title?: string; group: Group; cls?: string; cell: (n: Metrics) => ReactNode; csv: (n: Metrics) => unknown }

const val = (n: Metrics & { name?: string }, k: Key): number | string => {
  if (k === 'name') return (n.name || '').toLowerCase();
  if (k.startsWith('step:')) return n.steps[k.slice(5)]?.count ?? 0;
  if (k.startsWith('cost:')) return n.steps[k.slice(5)]?.cost ?? Infinity;
  if (k.startsWith('value:')) return n.steps[k.slice(6)]?.value ?? 0;
  if (k === 'roas') return n.crm.cashRoas ?? -1;
  if (k === 'delta') return n.deltaPurchases ?? -Infinity;
  const m = n.meta as unknown as Record<string, number | null>;
  const v = m[k];
  return v === null || v === undefined ? (/^(cpm|cpc)$/.test(k) ? Infinity : -1) : v;
};

// ---------- Cột Meta dùng chung ----------
const META: Record<string, Omit<Col, 'id' | 'group'>> = {
  spend: { label: 'Spend', cell: (n) => fmtMoney(n.meta.spend), csv: (n) => n.meta.spend },
  impressions: { label: 'Impr', title: 'Impressions', cell: (n) => fmtInt(n.meta.impressions), csv: (n) => n.meta.impressions },
  clicks: { label: 'Clicks', title: 'Link click', cell: (n) => fmtInt(n.meta.clicks), csv: (n) => n.meta.clicks },
  ctr: { label: 'CTR', title: 'Link click / impression', cell: (n) => fmtRate(n.meta.ctr), csv: (n) => n.meta.ctr },
  cpc: { label: 'CPC', title: 'Spend / link click', cell: (n) => fmtMoney(n.meta.cpc), csv: (n) => n.meta.cpc },
  cpm: { label: 'CPM', cell: (n) => fmtMoney(n.meta.cpm), csv: (n) => n.meta.cpm },
  lpv: { label: 'LP view', title: 'Landing page view', cell: (n) => fmtInt(n.meta.lpv), csv: (n) => n.meta.lpv },
  lpvRate: { label: 'LPV/click', title: 'Landing page view / link click', cell: (n) => fmtRate(n.meta.lpvRate), csv: (n) => n.meta.lpvRate },
  video3s: { label: 'View 3s', title: 'Lượt xem video 3 giây', cell: (n) => fmtInt(n.meta.video3s), csv: (n) => n.meta.video3s },
  hookRate: { label: 'Hook', title: 'Hook rate = view 3s / impression', cell: (n) => fmtRate(n.meta.hookRate), csv: (n) => n.meta.hookRate },
  thruplay: { label: 'ThruPlay', title: 'Xem ≥15 giây hoặc hết video', cell: (n) => fmtInt(n.meta.thruplay), csv: (n) => n.meta.thruplay },
  holdRate: { label: 'Hold', title: 'Hold rate = ThruPlay / view 3s', cell: (n) => fmtRate(n.meta.holdRate), csv: (n) => n.meta.holdRate },
  p25Rate: { label: 'Xem 25%', title: 'Xem tới 25% video / view 3s', cell: (n) => fmtRate(n.meta.p25Rate), csv: (n) => n.meta.p25Rate },
  p50Rate: { label: 'Xem 50%', title: 'Xem tới 50% video / view 3s', cell: (n) => fmtRate(n.meta.p50Rate), csv: (n) => n.meta.p50Rate },
  p75Rate: { label: 'Xem 75%', title: 'Xem tới 75% video / view 3s', cell: (n) => fmtRate(n.meta.p75Rate), csv: (n) => n.meta.p75Rate },
  p100Rate: { label: 'Xem hết', title: 'Xem hết video / view 3s', cell: (n) => fmtRate(n.meta.p100Rate), csv: (n) => n.meta.p100Rate },
};
const metaCol = (id: string): Col => ({ id, group: 'meta', ...META[id] });

export interface TablePreset { id: string; label: string; hint: string; cols: Col[] }

/**
 * Mẫu xem bảng. Mỗi mẫu = 1 nhu cầu, sinh từ mục tiêu Project:
 *  • Cơ bản: spend → views → từng bước Meta + chi phí.
 *  • "Ad → <bước CRM>": mỗi bước CRM 1 mẫu, chỉ hiện tới bước đó (vd Ad → Seat không có cột khóa học).
 *  • Giữ chân: số creative cho editor / designer (hook, ThruPlay, xem 25–100%, CTR…).
 */
export function buildPresets(steps: TableStep[], opts: { hasCrm: boolean; finalKey: string; compare: Props['compare'] }): TablePreset[] {
  const short = (s: string) => (s.length > 20 ? `${s.slice(0, 19)}…` : s);
  const count = (s: TableStep, group: Group): Col => ({ id: `step:${s.key}`, label: short(s.label), title: `${s.label} (${s.source === 'meta' ? 'Meta' : 'CRM'})`, group, cell: (n) => fmtInt(n.steps[s.key]?.count ?? 0), csv: (n) => n.steps[s.key]?.count ?? 0 });
  const cost = (s: TableStep, group: Group): Col => ({ id: `cost:${s.key}`, label: `${costLabel(s.label)} ${short(s.label)}`, title: `Chi phí / 1 ${s.label} (${s.source === 'meta' ? 'Meta' : 'CRM'})`, group, cell: (n) => fmtMoney(n.steps[s.key]?.cost ?? null), csv: (n) => n.steps[s.key]?.cost ?? '' });
  const value = (s: TableStep): Col => ({ id: `value:${s.key}`, label: 'Giá trị', title: `Giá trị ${s.label}`, group: 'crm', cell: (n) => fmtMoney(n.steps[s.key]?.value ?? 0), csv: (n) => n.steps[s.key]?.value ?? 0 });
  const roas: Col = { id: 'roas', label: 'ROAS', title: 'Phụ: giá trị CRM / spend', group: 'crm', cls: 'muted', cell: (n) => fmtRoas(n.crm.cashRoas), csv: (n) => n.crm.cashRoas ?? '' };
  const delta: Col = {
    id: 'delta', label: 'Meta/CRM', title: 'Meta tự báo lệch bao nhiêu so với CRM (cặp so sánh của mục tiêu)', group: 'delta',
    cell: (n) => (n.deltaPurchases === null ? DASH
      : <span className={`chip ${Math.abs(n.deltaPurchases) > 0.3 ? 'warn' : ''}`}>{n.deltaPurchases > 0 ? '▲' : '▼'} {Math.abs(Math.round(n.deltaPurchases * 100))}%</span>),
    csv: (n) => n.deltaPurchases ?? '',
  };
  const metaSteps = steps.filter((s) => s.source === 'meta');
  const crmSteps = steps.filter((s) => s.source === 'crm');
  const lastMeta = metaSteps[metaSteps.length - 1];

  const out: TablePreset[] = [{
    id: 'basic', label: 'Cơ bản', hint: 'Spend → views → từng bước Meta và chi phí mỗi bước',
    cols: [...['spend', 'impressions', 'clicks', 'ctr', 'lpv', 'video3s'].map(metaCol), ...metaSteps.flatMap((s) => [count(s, 'meta'), cost(s, 'meta')])],
  }];
  if (opts.hasCrm) {
    crmSteps.forEach((target, i) => {
      const upto = crmSteps.slice(0, i + 1);
      const isFinal = target.key === opts.finalKey;
      const withDelta = !!opts.compare && upto.some((s) => s.key === opts.compare!.crm) && metaSteps.some((s) => s.key === opts.compare!.meta);
      out.push({
        id: `to:${target.key}`, label: `Ad → ${target.label}`,
        hint: `Chỉ tính tới ${target.label}${isFinal ? ' (bước cuối, có giá trị và ROAS)' : ''}. So số Meta tự báo với CRM.`,
        cols: [
          metaCol('spend'),
          ...metaSteps.map((s) => count(s, 'meta')),
          ...(lastMeta ? [cost(lastMeta, 'meta')] : []),
          ...upto.flatMap((s) => [count(s, 'crm'), cost(s, 'crm')]),
          ...(isFinal ? [value(target), roas] : []),
          ...(withDelta ? [delta] : []),
        ],
      });
    });
  }
  out.push({
    id: 'retention', label: 'Giữ chân (creative)', hint: 'Cho editor / designer: hook, ThruPlay, tỷ lệ xem 25–100%, click, CTR',
    cols: ['spend', 'impressions', 'video3s', 'hookRate', 'thruplay', 'holdRate', 'p25Rate', 'p50Rate', 'p75Rate', 'p100Rate', 'clicks', 'ctr', 'cpc', 'cpm', 'lpvRate'].map(metaCol),
  });
  return out;
}

/** Mặc định: mẫu "Ad → bước CRM xa nhất đã có số" (vd chưa ai mua khóa học → Ad → Seat); chưa có CRM → Cơ bản. */
export function defaultPreset(presets: TablePreset[], steps: TableStep[]): string {
  const reached = steps.filter((s) => s.source === 'crm' && s.available && s.count > 0).map((s) => `to:${s.key}`);
  return [...presets].reverse().find((p) => reached.includes(p.id))?.id ?? presets.find((p) => p.id.startsWith('to:'))?.id ?? 'basic';
}

interface Line { node: ReportNode; depth: number; open: boolean | null }

function flatten(nodes: ReportNode[], open: Set<string>, key: Key, dir: 1 | -1, q: string, depth = 0): Line[] {
  const out: Line[] = [];
  const text = q.trim().toLowerCase();
  const matches = (n: ReportNode): boolean => !text || `${n.name} ${n.concept ?? ''} ${n.id}`.toLowerCase().includes(text) || n.children.some(matches);
  const sorted = [...nodes].sort((a, b) => { const x = val(a, key), y = val(b, key); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  for (const n of sorted) {
    if (!matches(n)) continue;
    const isOpen = n.children.length ? (text ? true : open.has(n.id)) : null;
    out.push({ node: n, depth, open: isOpen });
    if (isOpen) out.push(...flatten(n.children, open, key, dir, q, depth + 1));
  }
  return out;
}

const GROUP_LABEL: Record<Group, string> = { meta: 'META (tự báo)', crm: 'CRM (sự thật)', delta: 'Δ' };

export function ReportTable({ tree, total, unattributed, hasCrm, src, steps, primaryKey, finalKey, compare, baselineCost, fileName, storageKey, allowExport = true }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.map((c) => c.id)));
  const [key, setKey] = useState<Key>('spend');
  const [dir, setDir] = useState<1 | -1>(-1);
  const [q, setQ] = useState('');
  const [compact, setCompact] = useState(true);
  const presets = useMemo(() => buildPresets(steps, { hasCrm, finalKey, compare }), [steps, hasCrm, finalKey, compare]);
  const fallback = useMemo(() => defaultPreset(presets, steps), [presets, steps]);
  const [presetId, setPresetId] = useState<string>(fallback);
  const storeKey = `table:${storageKey}`;
  useEffect(() => {
    try { const saved = localStorage.getItem(storeKey); if (saved && presets.some((p) => p.id === saved)) setPresetId(saved); } catch { /* không có storage */ }
  }, [storeKey, presets]);
  const pickPreset = (id: string) => { setPresetId(id); try { localStorage.setItem(storeKey, id); } catch { /* bỏ qua */ } };
  const preset = presets.find((p) => p.id === presetId) ?? presets.find((p) => p.id === fallback)!;

  const showMeta = src !== 'crm';
  const showCrm = hasCrm && src !== 'meta';
  const cols = preset.cols.filter((c) => (c.group === 'meta' ? showMeta : c.group === 'crm' ? showCrm : showMeta && showCrm));
  const groups = (['meta', 'crm', 'delta'] as Group[]).map((g) => ({ g, n: cols.filter((c) => c.group === g).length })).filter((x) => x.n > 0);
  const ordered = groups.flatMap(({ g }) => cols.filter((c) => c.group === g));
  const lines = useMemo(() => flatten(tree, open, key, dir, q), [tree, open, key, dir, q]);

  const sort = (k: Key) => { if (k === key) setDir((d) => (d === 1 ? -1 : 1)); else { setKey(k); setDir(k === 'name' ? 1 : -1); } };
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allIds = useMemo(() => { const ids: string[] = []; const walk = (ns: ReportNode[]) => ns.forEach((n) => { if (n.children.length) { ids.push(n.id); walk(n.children); } }); walk(tree); return ids; }, [tree]);
  const arrow = (k: Key) => (k === key ? (dir === 1 ? ' ↑' : ' ↓') : '');
  /** Đốt tiền: tiêu ≥ 2× chi phí mục tiêu mà 0 chuyển đổi chính */
  const burn = (n: Metrics) => baselineCost !== null && n.meta.spend >= 2 * baselineCost && (n.steps[primaryKey]?.count ?? 0) === 0;

  const exportCsv = () => {
    const head = ['level', 'id', 'name', ...ordered.map((c) => c.title ?? c.label)];
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const all: ReportNode[] = []; const walk = (ns: ReportNode[]) => ns.forEach((n) => { all.push(n); walk(n.children); }); walk(tree);
    const csv = [head, ...all.map((n) => [n.level, n.id, n.name, ...ordered.map((c) => c.csv(n))])].map((r) => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${fileName}-${preset.id.replace(':', '-')}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const cells = (n: Metrics, unattr = false) => ordered.map((c) => {
    const tone = c.group === 'meta' ? 'm meta' : c.group === 'crm' ? 'c crm' : '';
    const isBurn = c.id === `cost:${primaryKey}` && !unattr && burn(n);
    const blank = unattr && c.group !== 'crm';
    return <td key={c.id} className={`n ${isBurn ? `${c.group === 'meta' ? 'm' : 'c'} burn` : tone}`} style={c.cls === 'muted' ? { color: 'var(--muted)' } : undefined}>{blank ? DASH : c.cell(n)}</td>;
  });

  return (
    <div className="panel tight">
      <div className="density" style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div className="seg presets" role="tablist" aria-label="Mẫu xem bảng">
          {presets.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={p.id === preset.id} title={p.hint} onClick={() => pickPreset(p.id)}>{p.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input aria-label="Lọc theo tên / concept / ID" placeholder="Lọc ad theo tên, concept, ID…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="ghost" onClick={() => setOpen(new Set(allIds))}>Mở hết</button>
          <button className="ghost" onClick={() => setOpen(new Set())}>Thu hết</button>
          <button className="ghost" onClick={() => setCompact((c) => !c)}>{compact ? 'Rộng' : 'Gọn'}</button>
          {allowExport && <button className="ghost" onClick={exportCsv}>Xuất CSV</button>}
        </div>
      </div>
      <div className="preset-hint">{preset.hint}</div>
      <div className="tablewrap" style={{ ['--row-h' as string]: compact ? '32px' : '40px' }}>
        <table className="data">
          <thead>
            <tr>
              <th className="stick l grp" rowSpan={2} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => sort('name')}>AD{arrow('name')}</th>
              {groups.map(({ g, n }) => <th key={g} className={`grp ${g}`} colSpan={n}>{GROUP_LABEL[g]}</th>)}
            </tr>
            <tr className="h2">
              {ordered.map((c) => (
                <th key={c.id} title={c.title ?? c.label} onClick={() => sort(c.id)} aria-sort={c.id === key ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>{c.label}{arrow(c.id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td className="l" colSpan={ordered.length + 1} style={{ textAlign: 'center', padding: 24, height: 'auto' }}>Không có dòng nào khớp.</td></tr>}
            {lines.map(({ node: n, open: isOpen }) => (
              <tr key={`${n.level}-${n.id}`} className={`lv-${n.level}`}>
                <td className="stick l" title={`${n.name} · ${n.id}`}>
                  <span className="cell-name">
                    {isOpen === null ? <span className="twisty" /> : <span className="twisty" role="button" tabIndex={0} aria-label={isOpen ? 'Thu gọn' : 'Mở rộng'} aria-expanded={isOpen}
                      onClick={() => toggle(n.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(n.id); } }}>{isOpen ? '▾' : '▸'}</span>}
                    <span className="t">{n.name || n.id}</span>
                    {n.isSac && <span className="chip warn" title="Special Ad Category">SAC</span>}
                    {n.level === 'ad' && n.stage && <span className="chip">{n.stage.replace('FU', '')}</span>}
                    {n.level === 'ad' && n.status && n.status !== 'ACTIVE' && <span className="chip" title={n.status}>{n.status === 'PAUSED' ? 'tắt' : n.status.toLowerCase().replace('_', ' ')}</span>}
                  </span>
                </td>
                {cells(n)}
              </tr>
            ))}
            {showCrm && !q && ordered.some((c) => c.group === 'crm') && (
              <tr className="unattr">
                <td className="stick l" title="Lead không có ad_id (UTM rơi) hoặc ad không thuộc campaign của Project">Unattributed ({unattributed.leadIds} lead)</td>
                {cells(unattributed, true)}
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr><td className="stick l">Tổng</td>{cells(total)}</tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
