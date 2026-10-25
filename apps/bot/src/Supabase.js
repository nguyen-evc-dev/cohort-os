/**
 * Đọc Supabase qua hàm public.bot_read (chạy bằng quyền bot_reader, chỉ đọc view tổng hợp bot.v_*).
 * Bot KHÔNG có quyền ghi, KHÔNG đọc được bảng lead/deal, KHÔNG chạm vào Meta.
 */
function botRead_(view, sinceDate) {
  var url = cfg_('SUPABASE_URL');
  var key = cfg_('SUPABASE_PUBLISHABLE_KEY');
  var token = cfg_('BOT_TOKEN');
  if (!url || !key || !token) throw new Error('Thiếu SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / BOT_TOKEN trong Script Properties');
  var res = UrlFetchApp.fetch(String(url).replace(/\/+$/, '') + '/rest/v1/rpc/bot_read', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key },
    payload: JSON.stringify({ p_token: token, p_view: view, p_since: sinceDate || null }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('bot_read ' + view + ' → HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}
