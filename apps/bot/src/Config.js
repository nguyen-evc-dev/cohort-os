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

function anthropicKey_() { return cfg_('ANTHROPIC_API_KEY'); }

/**
 * Space được phục vụ: ALLOWED_SPACES (danh sách "spaces/XXXX" cách nhau bằng dấu phẩy) cộng với space của webhook Alerts
 * (URL webhook có dạng .../v1/spaces/XXXX/messages?...). Tin nhắn riêng (DM) với sếp luôn được phục vụ.
 */
function allowedSpaces_() {
  var out = [];
  String(cfg_('ALLOWED_SPACES', '')).split(',').forEach(function (s) { s = s.trim(); if (s) out.push(s); });
  var m = /\/spaces\/([^\/?]+)/.exec(webhookFor_('alerts') || '');
  if (m) out.push('spaces/' + m[1]);
  return out;
}
