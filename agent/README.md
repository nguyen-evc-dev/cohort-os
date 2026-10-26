# agent — Sync Meta hằng ngày (Claude Desktop, CHỈ ĐỌC)

- Prompt: [meta-sync.md](meta-sync.md). Scheduled task `cohort-meta-sync-1405` và `cohort-meta-sync-1505` chỉ trỏ tới file này.
- Luồng: `npm run sync:gate` → (RUN) 5 tool đọc Meta → JSON vào `sync/inbox/<ngày>/` → `npm run sync:push -- sync/inbox/<ngày>`.
- Backfill lần đầu: mở Claude Code trong thư mục `cohort-os`, gõ: *"Chạy agent/meta-sync.md với BACKFILL_DAYS=45"*.

## Quyền chạy tự động (T1.3) — Nguyên tự dán 1 lần

Claude Code không tự sửa được file quyền của chính nó, nên cần anh dán tay.
Mở `C:\Users\ADMIN\.claude\settings.json` bằng Notepad. Trong `"permissions"`, thêm khối `"allow"` dưới đây **ngay trên** dòng `"deny": [`, giữ nguyên danh sách `deny` đang có:

```json
    "allow": [
      "mcp__005631b9-1fb7-466c-9021-3f0c6f0e81e0__ads_get_ad_accounts",
      "mcp__005631b9-1fb7-466c-9021-3f0c6f0e81e0__ads_get_field_context",
      "mcp__005631b9-1fb7-466c-9021-3f0c6f0e81e0__ads_get_ad_entities",
      "mcp__005631b9-1fb7-466c-9021-3f0c6f0e81e0__ads_account_get_activity_logs",
      "mcp__005631b9-1fb7-466c-9021-3f0c6f0e81e0__ads_get_creatives",
      "mcp__005631b9-1fb7-466c-9021-3f0c6f0e81e0__ads_get_customconversions",
      "Bash(cd \"D:/VIBE CODE/Cohort OS/cohort-os\")",
      "Bash(npm run sync:gate)",
      "Bash(npm run sync:push -- sync/inbox/*)",
      "Edit(//d/VIBE CODE/Cohort OS/cohort-os/sync/inbox/**)"
    ],
```

- 6 dòng đầu chỉ là tool **đọc** của Meta (dòng thứ 6 `ads_get_customconversions` thêm ngày 26/10: đọc danh mục custom conversion). 39 tool ghi vẫn nằm trong `deny`, và `deny` luôn thắng `allow`.
- Không thêm tool Meta nào khác vào `allow`.
- Không dán cũng được: lần **Run now** đầu tiên, Claude sẽ hỏi quyền, anh bấm **Always allow** cho đúng các mục trên. Quyền đó được lưu riêng cho task.
