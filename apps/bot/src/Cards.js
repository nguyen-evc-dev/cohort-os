/** Gửi tin vào Google Chat qua webhook của từng agent (cardsV2). */
function postToChat_(agent, message, threadName) {
  var url = webhookFor_(agent);
  if (!url) throw new Error('Thiếu webhook cho agent "' + agent + '" (AGENT_WEBHOOKS)');
  if (threadName) {
    message.thread = { name: threadName };
    url += (url.indexOf('?') >= 0 ? '&' : '?') + 'messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';
  }
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify(message), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('Webhook ' + agent + ' → HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText() || '{}');
}

function textCard_(id, title, text, buttons) {
  var widgets = [{ textParagraph: { text: text.replace(/\n/g, '<br>') } }];
  if (buttons && buttons.length) {
    widgets.push({ buttonList: { buttons: buttons.map(function (b) {
      return { text: b.text, onClick: { openLink: { url: b.url } } };
    }) } });
  }
  return { cardsV2: [{ cardId: id, card: { header: { title: title }, sections: [{ widgets: widgets }] } }] };
}

/** Tin E1 sau khi sync xong: tóm tắt + nhắc xuất HubSpot + checklist + nút Import. */
function syncOkMessage_(action, summary) {
  var msg = textCard_('sync-ok-' + action.run.id, '🤖 Số Meta ' + action.run.target_date, alertText(action, summary), [
    { text: 'Mở trang Import', url: webBaseUrl_() + '/import' },
    { text: 'Xem dashboard', url: webBaseUrl_() + '/' }
  ]);
  msg.cardsV2[0].card.sections.push({
    header: 'Checklist xuất HubSpot', collapsible: true, uncollapsibleWidgetsCount: 0,
    widgets: HUBSPOT_CHECKLIST.map(function (line) { return { textParagraph: { text: line } }; })
  });
  return msg;
}
