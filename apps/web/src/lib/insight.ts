import 'server-only';
import crypto from 'node:crypto';
import { buildInsightPayload, type InsightPayload } from '@cohort/core';
import type { LoadedReport } from './data';

/** Payload + phiên bản dữ liệu (băm nội dung). Cùng số liệu → cùng phiên bản → dùng lại nhận định đã lưu, không tốn token. */
export function insightContext(l: LoadedReport): { payload: InsightPayload; version: string; scopeId: string } {
  const payload = buildInsightPayload({
    projectName: l.project.name, report: l.report, signalsAsOf: l.signalsAsOf,
    signals: l.signals.map((s) => ({ type: s.type, color: s.color, level: s.level, entity_id: s.entity_id, action: s.action, compared_to: s.compared_to, numbers: s.numbers ?? {} })),
  });
  const version = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 40);
  return { payload, version, scopeId: l.project.id ?? 'all' };
}
