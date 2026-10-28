/**
 * T4.1 — Ai được ra lệnh cho Bé Sugar. Chặn chặt: thiếu email thì từ chối (không đoán), sai email thì từ chối,
 * ngoài space "Bot Growth Command" (và không phải tin nhắn riêng) thì từ chối.
 */

/** Gom thông tin cần dùng từ event (định dạng add-on của Google Chat; chịu được vài biến thể). */
function eventInfo_(event) {
  var chat = (event && event.chat) || {};
  var payload = chat.appCommandPayload || chat.messagePayload || chat.addedToSpacePayload || {};
  var message = payload.message || {};
  var space = payload.space || message.space || {};
  var user = chat.user || message.sender || {};
  var meta = payload.appCommandMetadata || {};
  var text = message.argumentText !== undefined && message.argumentText !== null ? message.argumentText : (message.text || '');
  return {
    email: user.email || null,
    userType: user.type || null,
    space: space.name || null,
    spaceType: space.spaceType || space.type || null,
    singleUserBotDm: !!space.singleUserBotDm,
    thread: (message.thread && message.thread.name) || null,
    messageName: message.name || null,
    text: String(text || '').replace(/^\s+|\s+$/g, ''),
    commandId: meta.appCommandId ? Number(meta.appCommandId) : null
  };
}

function isDm_(info) {
  return info.spaceType === 'DIRECT_MESSAGE' || info.spaceType === 'DM' || info.singleUserBotDm === true;
}

/** {ok:true} hoặc {ok:false, text} (câu từ chối gửi lại ngay trong Chat). */
function authorize_(info) {
  if (!info.email) return { ok: false, text: 'Em không thấy email người gửi nên không dám trả lời. Nhờ sếp nhắn lại trong space Bot Growth Command nha.' };
  if (String(info.email).toLowerCase() !== String(adminEmail_()).toLowerCase()) return { ok: false, text: 'Xin lỗi, em chỉ làm việc với sếp Nguyên nha.' };
  if (!isDm_(info) && allowedSpaces_().indexOf(info.space) < 0) return { ok: false, text: 'Em chỉ làm việc trong space Bot Growth Command hoặc tin nhắn riêng với sếp Nguyên nha.' };
  return { ok: true };
}
