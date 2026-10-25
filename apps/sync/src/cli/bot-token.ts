/**
 * npm run bot:token → tạo token mới cho Bé Sugar (in ra 1 lần), lưu SHA-256 vào public.bot_tokens,
 * thu hồi các token cũ. Dán token vào Script Properties BOT_TOKEN của Apps Script.
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../env';

loadEnv();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error('Thiếu SUPABASE_URL / SUPABASE_SECRET_KEY trong .env.local'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const token = crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const now = new Date().toISOString();

const { error: e1 } = await db.from('bot_tokens').update({ revoked_at: now }).is('revoked_at', null);
if (e1) { console.error(`bot_tokens: ${e1.message}`); process.exit(1); }
const { error: e2 } = await db.from('bot_tokens').insert({ token_hash: hash, label: 'gas' });
if (e2) { console.error(`bot_tokens: ${e2.message}`); process.exit(1); }

console.log('Token mới cho Bé Sugar (chỉ hiện 1 lần, token cũ đã bị thu hồi):');
console.log(token);
console.log('→ Apps Script → Project Settings → Script Properties → BOT_TOKEN = token trên.');
