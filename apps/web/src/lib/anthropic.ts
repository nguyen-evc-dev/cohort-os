import 'server-only';

/** Gọi Claude (Messages API). Key chỉ nằm ở biến môi trường server, không bao giờ xuống trình duyệt. */
export async function callClaude(input: { model: string; system: string; user: string; maxTokens?: number }): Promise<{ text: string } | { error: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: 'Chưa cấu hình ANTHROPIC_API_KEY (Setup Guide bước 5). Thêm vào apps/web/.env.local rồi chạy lại web.' };
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: input.model, max_tokens: input.maxTokens ?? 1200, system: input.system, messages: [{ role: 'user', content: input.user }] }),
      signal: AbortSignal.timeout(60_000),
      cache: 'no-store',
    });
  } catch (e) {
    return { error: `Không gọi được Claude (${(e as Error).name === 'TimeoutError' ? 'quá 60 giây' : 'lỗi mạng'}).` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const msg = res.status === 401 ? 'API key không hợp lệ' : res.status === 429 ? 'Vượt giới hạn tốc độ, thử lại sau' : res.status === 529 ? 'Claude đang quá tải' : `HTTP ${res.status}`;
    return { error: `Claude từ chối: ${msg}.${process.env.NODE_ENV !== 'production' ? ` ${body.slice(0, 160)}` : ''}` };
  }
  const json = await res.json() as { content?: { type: string; text?: string }[] };
  const text = (json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
  return text ? { text } : { error: 'Claude trả về nội dung rỗng.' };
}
