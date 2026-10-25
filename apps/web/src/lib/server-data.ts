import 'server-only';
import { cache } from 'react';
import { createClient } from './supabase/server';
import { loadWorkspace } from './data';

/** Một lần render chỉ truy vấn workspace 1 lần (layout + trang dùng chung). */
export const getWorkspace = cache(async () => loadWorkspace(await createClient()));
