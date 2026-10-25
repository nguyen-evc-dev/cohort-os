import { mergeWithDefaultConfig, parseConfigRows, type Config } from '../src/index';

/** Config mặc định + ghi đè (tương đương defaultConfig(g, overrides, scopes) của bộ test GAS cũ). */
export function makeCfg(overrides: Record<string, string | number> = {}, scopes: Config['scopes'] = {}): Config {
  const c = mergeWithDefaultConfig(parseConfigRows([]));
  Object.assign(c.global, overrides);
  c.scopes = scopes;
  return c;
}
