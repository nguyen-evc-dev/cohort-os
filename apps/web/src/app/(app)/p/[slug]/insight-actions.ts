'use server';
import { revalidatePath } from 'next/cache';
import { findUngroundedNumbers, insightSystemPrompt, insightUserMessage, INSIGHT_MODEL } from '@cohort/core';
import { requireAdmin } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/server-data';
import { loadReport } from '@/lib/data';
import { parseFilters } from '@/lib/filters';
import { callClaude } from '@/lib/anthropic';
import { insightContext } from '@/lib/insight';

export type InsightResult =
  | { ok: true; text: string; createdAt: string; cached: boolean; warning?: string }
  | { ok: false; error: string };

interface Input { slug: string; d?: string; from?: string; to?: string; src?: string; refresh?: boolean }

/**
 * Nhận định AI cho 1 Project. Code dựng payload tổng hợp (không PII, đã quét), Claude chỉ diễn giải bằng skill `ads-deep-analysis`.
 * Mọi con số trong câu trả lời phải có trong payload; sai thì cho Claude viết lại 1 lần, vẫn sai thì KHÔNG lưu.
 */
export async function generateInsight(input: Input): Promise<InsightResult> {
  const { supabase } = await requireAdmin();
  const ws = await getWorkspace();
  const f = parseFilters({ d: input.d, from: input.from, to: input.to, src: input.src }, ws.latestDate);
  const loaded = await loadReport(supabase, ws, String(input.slug), f);
  if (!loaded) return { ok: false, error: 'Không tìm thấy Project.' };
  if (loaded.report.total.meta.spend <= 0) return { ok: false, error: 'Chưa có chi tiêu trong khoảng này để phân tích.' };

  const { payload, version, scopeId } = insightContext(loaded);
  const key = { scope: 'project', scope_id: scopeId, kind: 'report', data_version: version };

  if (!input.refresh) {
    const { data } = await supabase.from('insights').select('body,created_at').match(key).maybeSingle();
    if (data) return { ok: true, text: data.body, createdAt: data.created_at, cached: true };
  }

  let user: string;
  try { user = insightUserMessage(payload); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const system = insightSystemPrompt();

  let res = await callClaude({ model: INSIGHT_MODEL, system, user });
  if ('error' in res) return { ok: false, error: res.error };
  let bad = findUngroundedNumbers(res.text, payload);
  if (bad.length) {
    const retry = await callClaude({
      model: INSIGHT_MODEL, system,
      user: `${user}\n\n---\nBản nháp trước dùng các số KHÔNG có trong dữ liệu: ${bad.join(', ')}. Viết lại toàn bộ, chỉ dùng số có nguyên văn trong dữ liệu, bỏ ý nào không có số hỗ trợ.`,
    });
    if ('text' in retry) { res = retry; bad = findUngroundedNumbers(res.text, payload); }
  }
  if (bad.length) {
    return { ok: true, text: res.text, createdAt: new Date().toISOString(), cached: false,
      warning: `Chưa lưu: câu trả lời còn dùng số không có trong dữ liệu (${bad.join(', ')}). Bấm Làm mới để thử lại.` };
  }

  const createdAt = new Date().toISOString();
  const { error } = await supabase.from('insights').upsert({ ...key, body: res.text.slice(0, 8000), model: INSIGHT_MODEL, created_at: createdAt }, { onConflict: 'scope,scope_id,kind,data_version' });
  if (error) return { ok: true, text: res.text, createdAt, cached: false, warning: `Chưa lưu được vào DB (${error.message}).` };
  revalidatePath(`/p/${input.slug}`);
  return { ok: true, text: res.text, createdAt, cached: false };
}
