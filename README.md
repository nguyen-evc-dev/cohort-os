# Cohort OS v3 (personal)

Báo cáo master Meta Ads → HubSpot (seat/program) cho Nguyên, cùng trợ lý **Bé Sugar** trên Google Chat.
Spec: `../ARCHITECTURE_CohortOS.md` · `../PRD_CohortOS_v3.md` · `../TICKETS_CohortOS_v3.md` · `../SETUP GUIDE.md`

## Cấu trúc

| Thư mục | Nội dung | Ticket |
|---|---|---|
| `packages/core` | Logic thuần dùng chung: parse tên ad, mốc chuẩn + tín hiệu, đèn RYG, đọc export HubSpot, che mờ/phát hiện PII, giờ sync | **T0.1 ✅** |
| `apps/sync` | CLI trên máy: `sync:gate`, `sync:push`, `import:hubspot` | T1.2, T3.1 |
| `apps/web` | Next.js (Vercel) | T2.x |
| `apps/bot` | Google Apps Script: Bé Sugar + agent webhooks | T1.5, T4.x |
| `skills/` | `ads-deep-analysis`, `ryg-decision`, `policy-sac-audit` | T5.x |
| `agent/` | Prompt scheduled task lấy số Meta (chỉ đọc) | T1.1 |
| `supabase/migrations` | Schema + RLS + test bảo mật | T0.2, T0.4 |

## Lệnh

```bash
pnpm install
```
```bash
pnpm test
```
```bash
pnpm typecheck
```

## Quy tắc
- **Không PII** ra khỏi máy: mọi dữ liệu gửi đi phải qua `assertNoPii` (`packages/core/src/mask.ts`).
- **Meta chỉ đọc**: 39 tool ghi của connector bị `deny` trong `~/.claude/settings.json`.
- `.env.local` là secret, đã bị `.gitignore` chặn. Mẫu ở `.env.example`.
