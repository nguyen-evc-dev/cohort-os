'use client';
import { useMemo, useState } from 'react';
import type { Metrics, ReportNode } from '@cohort/core';
import { DASH, fmtDelta, fmtInt, fmtMoney, fmtRate, fmtRoas } from '@/lib/format';

type Key = 'name' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'leadsMeta' | 'purchases' | 'cpaMeta' | 'leads' | 'seats' | 'revenue' | 'cpaSeat' | 'roas' | 'delta';
interface Props {
  tree: ReportNode[];
  total: Metrics;
  unattributed: Metrics & { leadIds: number };
  hasCrm: boolean;
  src: 'meta' | 'crm' | 'both';
  /** Chi phí trung bình mỗi kết quả của cả Project, để tô đỏ ad đốt tiền. */
  baselineCost: number | null;
  fileName: string;
  allowExport?: boolean;
}

const val = (n: Metrics & { name?: string }, k: Key): number | string => {
  switch (k) {
    case 'name': return (n.name || '').toLowerCase();
    case 'spend': return n.meta.spend; case 'impressions': return n.meta.impressions; case 'clicks': return n.meta.clicks;
    case 'ctr': return n.meta.ctr ?? -1; case 'leadsMeta': return n.meta.leads; case 'purchases': return n.meta.purchases;
    case 'cpaMeta': return n.meta.cpaMeta ?? Infinity; case 'leads': return n.crm.leads; case 'seats': return n.crm.seats;
    case 'revenue': return n.crm.revenue; case 'cpaSeat': return n.crm.cpaSeat ?? Infinity; case 'roas': return n.crm.cashRoas ?? -1;
    case 'delta': return n.deltaPurchases ?? -Infinity;
  }
};

interface Line { node: ReportNode; depth: number; open: boolean | null }

function flatten(nodes: ReportNode[], open: Set<string>, key: Key, dir: 1 | -1, q: string, depth = 0): Line[] {
  const out: Line[] = [];
  const text = q.trim().toLowerCase();
  const matches = (n: ReportNode): boolean => !text || `${n.name} ${n.concept ?? ''} ${n.id}`.toLowerCase().includes(text) || n.children.some(matches);
  const sorted = [...nodes].sort((a, b) => {
    const x = val(a, key), y = val(b, key);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
  for (const n of sorted) {
    if (!matches(n)) continue;
    const isOpen = n.children.length ? (text ? true : open.has(n.id)) : null;
    out.push({ node: n, depth, open: isOpen });
    if (isOpen) out.push(...flatten(n.children, open, key, dir, q, depth + 1));
  }
  return out;
}

export function ReportTable({ tree, total, unattributed, hasCrm, src, baselineCost, fileName, allowExport = true }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.map((c) => c.id)));
  const [key, setKey] = useState<Key>('spend');
  const [dir, setDir] = useState<1 | -1>(-1);
  const [q, setQ] = useState('');
  const [compact, setCompact] = useState(true);
  const showMeta = src !== 'crm';
  const showCrm = hasCrm && src !== 'meta';
  const lines = useMemo(() => flatten(tree, open, key, dir, q), [tree, open, key, dir, q]);

  const sort = (k: Key) => { if (k === key) setDir((d) => (d === 1 ? -1 : 1)); else { setKey(k); setDir(k === 'name' ? 1 : -1); } };
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allIds = useMemo(() => { const ids: string[] = []; const walk = (ns: ReportNode[]) => ns.forEach((n) => { if (n.children.length) { ids.push(n.id); walk(n.children); } }); walk(tree); return ids; }, [tree]);
  const arrow = (k: Key) => (k === key ? (dir === 1 ? ' ↑' : ' ↓') : '');
  const th = (k: Key, label: string, cls = '') => <th key={k} className={cls} onClick={() => sort(k)} aria-sort={k === key ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>{label}{arrow(k)}</th>;

  const burn = (n: Metrics) => baselineCost !== null && n.meta.spend >= 2 * baselineCost && (showCrm ? n.crm.seats === 0 : n.meta.leads + n.meta.purchases === 0);

  const exportCsv = () => {
    const head = ['level', 'id', 'name', 'spend', 'impressions', 'clicks', 'ctr', 'leads_meta', 'purchases_meta', 'cpa_meta', ...(showCrm ? ['crm_leads', 'seats', 'revenue', 'cpa_seat', 'cash_roas'] : [])];
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const row = (n: ReportNode) => [n.level, n.id, n.name, n.meta.spend, n.meta.impressions, n.meta.clicks, n.meta.ctr ?? '', n.meta.leads, n.meta.purchases, n.meta.cpaMeta ?? '',
      ...(showCrm ? [n.crm.leads, n.crm.seats, n.crm.revenue, n.crm.cpaSeat ?? '', n.crm.cashRoas ?? ''] : [])];
    const all: ReportNode[] = []; const walk = (ns: ReportNode[]) => ns.forEach((n) => { all.push(n); walk(n.children); }); walk(tree);
    const csv = [head, ...all.map(row)].map((r) => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${fileName}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const metaCells = (n: Metrics, bold = false) => showMeta && (
    <>
      <td className="n m meta">{fmtMoney(n.meta.spend)}</td>
      <td className="n m hide-md">{fmtInt(n.meta.impressions)}</td>
      <td className="n m hide-md">{fmtInt(n.meta.clicks)}</td>
      <td className="n m hide-md">{fmtRate(n.meta.ctr)}</td>
      <td className="n m meta">{fmtInt(n.meta.leads)}</td>
      <td className="n m meta">{fmtInt(n.meta.purchases)}</td>
      <td className={`n m meta ${bold ? '' : ''}`}>{fmtMoney(n.meta.cpaMeta)}</td>
    </>
  );
  const crmCells = (n: Metrics) => showCrm && (
    <>
      <td className="n c crm">{fmtInt(n.crm.leads)}</td>
      <td className="n c crm">{fmtInt(n.crm.seats)}</td>
      <td className="n c crm">{fmtMoney(n.crm.revenue)}</td>
      <td className={`n c ${burn(n) ? 'burn' : 'crm'}`}>{fmtMoney(n.crm.cpaSeat)}</td>
      <td className="n c crm">{fmtRoas(n.crm.cashRoas)}</td>
    </>
  );
  const deltaCell = (n: Metrics) => showCrm && showMeta && (
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
              {showMeta && <th className="grp meta" colSpan={7}>META (tự báo)</th>}
              {showCrm && <th className="grp crm" colSpan={5}>CRM (sự thật)</th>}
              {showCrm && showMeta && <th className="grp delta">Δ</th>}
            </tr>
            <tr className="h2">
              {showMeta && <>{th('spend', 'Spend')}{th('impressions', 'Impr', 'hide-md')}{th('clicks', 'Clicks', 'hide-md')}{th('ctr', 'CTR', 'hide-md')}{th('leadsMeta', 'Lead')}{th('purchases', 'Purch.')}{th('cpaMeta', 'CPA')}</>}
              {showCrm && <>{th('leads', 'Lead')}{th('seats', 'Seat')}{th('revenue', 'Revenue')}{th('cpaSeat', 'CPA thực')}{th('roas', 'Cash ROAS')}</>}
              {showCrm && showMeta && th('delta', 'Purch.')}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td className="l" colSpan={20} style={{ textAlign: 'center', padding: 24, height: 'auto' }}>Không có dòng nào khớp.</td></tr>}
            {lines.map(({ node: n, depth, open: isOpen }) => (
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
                {showMeta && <><td className="n m">{DASH}</td><td className="n m hide-md">{DASH}</td><td className="n m hide-md">{DASH}</td><td className="n m hide-md">{DASH}</td><td className="n m">{DASH}</td><td className="n m">{DASH}</td><td className="n m">{DASH}</td></>}
                {crmCells(unattributed)}
                {showMeta && <td className="n">{DASH}</td>}
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="stick l">Tổng</td>
              {metaCells(total, true)}{crmCells(total)}{deltaCell(total)}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
