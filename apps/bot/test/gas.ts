/**
 * Sandbox giả lập Google Apps Script cho test: nạp các file src/*.js vào 1 vm context, giả lập
 * PropertiesService / CacheService / LockService / ScriptApp (trigger) / UrlFetchApp (Supabase bot_read, webhook Chat, Anthropic) / Utilities.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
export const FILES = ['Core.generated.js', 'Logic.js', 'Config.js', 'Supabase.js', 'Cards.js', 'Alerts.js', 'Guard.js', 'Router.js', 'Reports.js', 'Claude.js', 'Commands.js', 'Jobs.js', 'Chat.js'];

export function fmt(d: Date, tz: string): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export const WEBHOOKS = {
  alerts: 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=alerts',
  analyst: 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=analyst',
  ryg: 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=ryg',
  auditor: 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=auditor',
};

export interface GasOpts {
  now: string;
  props?: Record<string, string | null>;
  db?: Record<string, any[]>;
  /** Trả lời giả của Anthropic Messages API (mỗi lần gọi). Bỏ trống = không gọi được. */
  anthropic?: (body: any, callIndex: number) => any;
}
export interface Posted { url: string; agent: string; body: any }

export function loadGas(opts: GasOpts) {
  const props: Record<string, string> = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', BOT_TOKEN: 't'.repeat(43),
    AGENT_WEBHOOKS: JSON.stringify({ alerts: WEBHOOKS.alerts }), WEB_BASE_URL: 'http://localhost:3100', ADMIN_EMAIL: 'nguyen@evancoaching.net',
  };
  for (const [k, v] of Object.entries(opts.props || {})) { if (v === null) delete props[k]; else props[k] = v; }
  const posted: Posted[] = [];
  const reads: any[] = [];
  const claudeCalls: any[] = [];
  const logs: string[] = [];
  const triggers: { id: string; handler: string; afterMs?: number }[] = [];
  const cache = new Map<string, string>();
  const RealDate = Date;
  let fixed = new RealDate(opts.now).getTime();
  class FakeDate extends RealDate {
    constructor(...a: any[]) { super(...((a.length ? a : [fixed]) as [])); }
    static now() { return fixed; }
  }
  let trigSeq = 0;
  const sb: Record<string, any> = {
    Date: FakeDate, JSON, Math, Number, String, Error, console: { log: (...a: any[]) => logs.push(a.join(' ')), error: (...a: any[]) => logs.push('ERR ' + a.join(' ')) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k: string) => (k in props ? props[k] : null),
      setProperty: (k: string, v: string) => { props[k] = v; },
      deleteProperty: (k: string) => { delete props[k]; },
      getProperties: () => ({ ...props }),
    }) },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => { cache.set(k, v); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: {
      newTrigger: (handler: string) => ({ timeBased: () => ({ after: (ms: number) => ({ create: () => { triggers.push({ id: `trg-${++trigSeq}`, handler, afterMs: ms }); } }), everyMinutes: () => ({ create: () => { triggers.push({ id: `trg-${++trigSeq}`, handler }); } }) }) }),
      getProjectTriggers: () => triggers.map((t) => ({ getUniqueId: () => t.id, getHandlerFunction: () => t.handler })),
      deleteTrigger: (t: { getUniqueId: () => string }) => { const i = triggers.findIndex((x) => x.id === t.getUniqueId()); if (i >= 0) triggers.splice(i, 1); },
    },
    Utilities: { formatDate: (d: Date, tz: string, f: string) => (f === 'yyyy-MM-dd' ? fmt(d, tz).slice(0, 10) : fmt(d, tz)) },
    Logger: { log: () => {} },
    UrlFetchApp: { fetch: (url: string, o: any) => {
      const ok = (data: unknown) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(data) });
      if (url.includes('/rpc/bot_read')) {
        const body = JSON.parse(o.payload);
        reads.push(body);
        if (o.headers.apikey !== 'sb_publishable_x') throw new Error('apikey sai');
        return ok((opts.db || {})[body.p_view] || []);
      }
      if (url.startsWith('https://api.anthropic.com/')) {
        if (!opts.anthropic) throw new Error('Không có mock Anthropic');
        const body = JSON.parse(o.payload);
        claudeCalls.push({ body, headers: o.headers });
        return ok(opts.anthropic(body, claudeCalls.length - 1));
      }
      const agent = Object.entries(WEBHOOKS).find(([, u]) => url.startsWith(u.split('&token=')[0]) && url.includes(u.split('&token=')[1]))?.[0] ?? 'unknown';
      posted.push({ url, agent, body: JSON.parse(o.payload) });
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    } },
  };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sb, { filename: f });
  return { sb, props, posted, reads, claudeCalls, logs, triggers, cache, setNow: (iso: string) => { fixed = new RealDate(iso).getTime(); } };
}

// ---- Sự kiện Chat (định dạng add-on) ----
export const SPACE = 'spaces/AAA';
interface EvOpts { email?: string | null; space?: string; spaceType?: string; thread?: string; name?: string }
export function cmdEvent(commandId: number, argText: string, o: EvOpts = {}) {
  return { chat: {
    user: { email: o.email === undefined ? 'nguyen@evancoaching.net' : o.email, type: 'HUMAN' },
    appCommandPayload: {
      appCommandMetadata: { appCommandId: String(commandId), appCommandType: 'SLASH_COMMAND' },
      space: { name: o.space ?? SPACE, spaceType: o.spaceType ?? 'SPACE' },
      message: { name: o.name ?? `${SPACE}/messages/m${commandId}.${argText.length}`, argumentText: argText ? ` ${argText}` : '', text: `/cmd ${argText}`, thread: { name: o.thread ?? `${SPACE}/threads/T1` } },
    },
  } };
}
export function msgEvent(text: string, o: EvOpts = {}) {
  return { chat: {
    user: { email: o.email === undefined ? 'nguyen@evancoaching.net' : o.email, type: 'HUMAN' },
    messagePayload: {
      space: { name: o.space ?? SPACE, spaceType: o.spaceType ?? 'SPACE' },
      message: { name: o.name ?? `${SPACE}/messages/f.${text.length}`, argumentText: ` ${text}`, text: `@Bé Sugar ${text}`, thread: { name: o.thread ?? `${SPACE}/threads/T2` } },
    },
  } };
}
export const ackText = (r: any): string => r.hostAppDataAction.chatDataAction.createMessageAction.message.text;
