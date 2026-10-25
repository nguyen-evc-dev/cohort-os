/**
 * Cấu hình đọc từ Script Properties (Project Settings → Script Properties). KHÔNG ghi secret vào code.
 *   SUPABASE_URL              https://<ref>.supabase.co
 *   SUPABASE_PUBLISHABLE_KEY  sb_publishable_… (key công khai; một mình nó không đọc được gì)
 *   BOT_TOKEN                 token tạo bằng `npm run bot:token` trên máy Nguyên
 *   AGENT_WEBHOOKS            {"alerts":"<URL>","analyst":"<URL>","ryg":"<URL>","auditor":"<URL>"}
 *   ADMIN_EMAIL               nguyen@evancoaching.net
 *   WEB_BASE_URL              http://localhost:3100 (đổi sang https://<app>.vercel.app khi deploy)
 */
function cfg_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? (fallback === undefined ? null : fallback) : v;
}

function webhookFor_(agent) {
  var map = {};
  try { map = JSON.parse(cfg_('AGENT_WEBHOOKS', '{}')); } catch (e) { map = {}; }
  return map[agent] || map.alerts || null;
}

function adminEmail_() { return cfg_('ADMIN_EMAIL', 'nguyen@evancoaching.net'); }
function webBaseUrl_() { return String(cfg_('WEB_BASE_URL', 'http://localhost:3100')).replace(/\/+$/, ''); }
