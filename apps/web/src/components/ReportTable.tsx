'use client';
import { useMemo, useState } from 'react';
import type { Metrics, ReportNode } from '@cohort/core';
import { DASH, fmtInt, fmtMoney, fmtRate, fmtRoas } from '@/lib/format';

export interface TableStep { key: string; label: string; source: 'meta' | 'crm' }
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
  /** Có cặp so sánh Meta ↔ CRM (cột Δ) */
  hasCompare: boolean;
  /** Chi phí mục tiêu (target hoặc trung bình Project) trên bước chính, để tô đỏ ad đốt tiền. */
  baselineCost: number | null;
  fileName: string;
  allowExport?: boolean;
}

type Key = string; // 'name' | 'spend' | ... | 'step:<key>' | 'cost:<key>'
const val = (n: Metrics & { name?: string }, k: Key): number | string => {
  if (k === 'name') return (n.name || '').toLowerCase();
  if (k.startsWith('step:')) return n.steps[k.slice(5)]?.count ?? 0;
  if (k.startsWith('cost:')) return n.steps[k.slice(5)]?.cost ?? Infinity;
  if (k.startsWith('value:')) return n.steps[k.slice(6)]?.value ?? 0;
  switch (k) {
    case 'spend': return n.meta.spend; case 'impressions': return n.meta.impressions; case 'clicks': return n.meta.clicks;
    case 'ctr': return n.meta.ctr ?? -1; case 'cpm': return n.meta.cpm ?? Infinity; case 'roas': return n.crm.cashRoas ?? -1;
    case 'delta': return n.deltaPurchases ?? -Infinity;
    default: return 0;
  }
};

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

export function ReportTable({ tree, total, unattributed, hasCrm, src, steps, primaryKey, finalKey, hasCompare, baselineCost, fileName, allowExport = true }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.map((c) => c.id)));
  const [key, setKey] = useState<Key>('spend');
  const [dir, setDir] = useState<1 | -1>(-1);
  const [q, setQ] = useState('');
  const [compact, setCompact] = useState(true);
  const showMeta = src !== 'crm';
  const showCrm = hasCrm && src !== 'meta';
  const metaSteps = steps.filter((s) => s.source === 'meta');
  const crmSteps = steps.filter((s) => s.source === 'crm');
  const primary = steps.find((s) => s.key === primaryKey);
  const final = steps.find((s) => s.key === finalKey);
  const primaryInMeta = primary?.source === 'meta';
  const finalInCrm = final?.source === 'crm';
  const metaCols = 4 + metaSteps.length + (primaryInMeta ? 1 : 0);
  const crmCols = crmSteps.length + (finalInCrm ? 2 : 0) + (primary && !primaryInMeta ? 1 : 0) + 1;
  const lines = useMemo(() => flatten(tree, open, key, dir, q), [tree, open, key, dir, q]);

  const sort = (k: Key) => { if (k === key) setDir((d) => (d === 1 ? -1 : 1)); else { setKey(k); setDir(k === 'name' ? 1 : -1); } };
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allIds = useMemo(() => { const ids: string[] = []; const walk = (ns: ReportNode[]) => ns.forEach((n) => { if (n.children.length) { ids.push(n.id); walk(n.children); } }); walk(tree); return ids; }, [tree]);
  const arrow = (k: Key) => (k === key ? (dir === 1 ? ' ↑' : ' ↓') : '');
  const th = (k: Key, label: string, cls = '', title?: string) => (
    <th key={k} className={cls} title={title ?? label} onClick={() => sort(k)} aria-sort={k === key ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>{label}{arrow(k)}</th>
  );
  const short = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);
  /** Đốt tiền: tiêu ≥ 2× chi phí mục tiêu mà 0 chuyển đổi chính */
  const burn = (n: Metrics) => baselineCost !== null && n.meta.spend >= 2 * baselineCost && (n.steps[primaryKey]?.count ?? 0) === 0;

  const exportCsv = () => {
    const head = ['level', 'id', 'name', 'spend', 'impressions', 'clicks', 'ctr', ...steps.flatMap((s) => [`${s.key}_count`, `${s.key}_cost`]), ...(final ? [`${final.key}_value`] : [])];
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const row = (n: ReportNode) => [n.level, n.id, n.name, n.meta.spend, n.meta.impressions, n.meta.clicks, n.meta.ctr ?? '',
      ...steps.flatMap((s) => [n.steps[s.key]?.count ?? 0, n.steps[s.key]?.cost ?? '']), ...(final ? [n.steps[final.key]?.value ?? 0] : [])];
    const all: ReportNode[] = []; const walk = (ns: ReportNode[]) => ns.forEach((n) => { all.push(n); walk(n.children); }); walk(tree);
    const csv = [head, ...all.map(row)].map((r) => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${fileName}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const metaCells = (n: Metrics, unattr = false) => showMeta && (
    <>
      <td className="n m meta">{unattr ? DASH : fmtMoney(n.meta.spend)}</td>
      <td className="n m hide-md">{unattr ? DASH : fmtInt(n.meta.impressions)}</td>
      <td className="n m hide-md">{unattr ? DASH : fmtInt(n.meta.clicks)}</td>
      <td className="n m hide-md">{unattr ? DASH : fmtRate(n.meta.ctr)}</td>
      {metaSteps.map((s) => <td key={s.key} className="n m meta">{unattr ? DASH : fmtInt(n.steps[s.key]?.count ?? 0)}</td>)}
      {primaryInMeta && <td className={`n m ${!unattr && burn(n) ? 'burn' : 'meta'}`}>{unattr ? DASH : fmtMoney(n.steps[primaryKey]?.cost ?? null)}</td>}
    </>
  );
  const crmCells = (n: Metrics) => showCrm && (
    <>
      {crmSteps.map((s) => <td key={s.key} className="n c crm">{fmtInt(n.steps[s.key]?.count ?? 0)}</td>)}
      {primary && !primaryInMeta && <td className={`n c ${burn(n) ? 'burn' : 'crm'}`}>{fmtMoney(n.steps[primaryKey]?.cost ?? null)}</td>}
      {finalInCrm && <><td className="n c crm">{fmtMoney(n.steps[finalKey]?.cost ?? null)}</td><td className="n c crm">{fmtMoney(n.steps[finalKey]?.value ?? 0)}</td></>}
      <td className="n c" style={{ color: 'var(--muted)' }}>{fmtRoas(n.crm.cashRoas)}</td>
    </>
  );
  const deltaCell = (n: Metrics) => showCrm && showMeta && hasCompare && (
    <td className="n">{n.deltaPurchases === null ? DASH
      : <span className={`chip ${Math.abs(n.deltaPurchases) > 0.3 ? 'warn' : ''}`}>{n.deltaPurchases > 0 ? '▲' : '▼'} {Math.abs(Math.round(n.deltaPurchases * 100))}%</span>}</td>
  );

  return (
    <div className="panel tight">
      <div className="density">
        <input aria-label="Lọc theo tên / concept / ID" placeholder="Lọc ad theo tên, concept, ID…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="ghost" onClick={() => setOpen(new Set(allIds))}>Mở hết</button>
        <button className="ghost" onClick={() => setOpen(new Set())}>Thu hết</button>
        <button className="ghost" onClick={() => setCompact((c) => !c)}>{compact ? 'Rộng' : 'Gọn'}</button>
        {allowExport && <button className="ghost" onClick={exportCsv}>Xuất CSV</button>}
      </div>
      <div className="tablewrap" style={{ ['--row-h' as string]: compact ? '32px' : '40px' }}>
        <table className="data">
          <thead>
            <tr>
              <th className="stick l grp" rowSpan={2} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => sort('name')}>AD{arrow('name')}</th>
              {showMeta && <th className="grp meta" colSpan={metaCols}>META (tự báo)</th>}
              {showCrm && <th className="grp crm" colSpan={crmCols}>CRM (sự thật)</th>}
              {showCrm && showMeta && hasCompare && <th className="grp delta">Δ</th>}
            </tr>
            <tr className="h2">
              {showMeta && <>
                {th('spend', 'Spend')}{th('impressions', 'Impr', 'hide-md')}{th('clicks', 'Clicks', 'hide-md')}{th('ctr', 'CTR', 'hide-md')}
                {metaSteps.map((s) => th(`step:${s.key}`, short(s.label), '', s.label))}
                {primaryInMeta && th(`cost:${primaryKey}`, `CPA ${short(primary!.label)}`, '', `Chi phí / ${primary!.label}`)}
              </>}
              {showCrm && <>
                {crmSteps.map((s) => th(`step:${s.key}`, short(s.label), '', s.label))}
                {primary && !primaryInMeta && th(`cost:${primaryKey}`, `CPA ${short(primary.label)}`, '', `Chi phí / ${primary.label}`)}
                {finalInCrm && <>{th(`cost:${finalKey}`, `CPA ${short(final!.label)}`, '', `Chi phí / ${final!.label}`)}{th(`value:${finalKey}`, 'Giá trị', '', `Giá trị ${final!.label}`)}</>}
                {th('roas', 'ROAS', '', 'Phụ: giá trị CRM / spend')}
              </>}
              {showCrm && showMeta && hasCompare && th('delta', 'Meta/CRM')}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td className="l" colSpan={40} style={{ textAlign: 'center', padding: 24, height: 'auto' }}>Không có dòng nào khớp.</td></tr>}
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
                {metaCells(n)}{crmCells(n)}{deltaCell(n)}
              </tr>
            ))}
            {showCrm && !q && (
              <tr className="unattr">
                <td className="stick l" title="Lead không có ad_id (UTM rơi) hoặc ad không thuộc campaign của Project">Unattributed ({unattributed.leadIds} lead)</td>
                {metaCells(unattributed, true)}{crmCells(unattributed)}{showMeta && hasCompare && <td className="n">{DASH}</td>}
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr><td className="stick l">Tổng</td>{metaCells(total)}{crmCells(total)}{deltaCell(total)}</tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
