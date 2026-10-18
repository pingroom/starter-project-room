import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { fail, keys } from './model.js';
import { readJson } from './storage.js';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const credentialsPath = resolve(root, '.pingroom/credentials.json');
export const API_URL = 'https://api.pingroom.io';
export function loadEnv() {
  try { process.loadEnvFile(resolve(root, '.env')); }
  catch (error) { if (error.code !== 'ENOENT') fail('invalid_env', 'Could not load .env.'); }
}
export async function loadConnection(env = process.env, path = credentialsPath) {
  let raw;
  if (env.PINGROOM_TOKEN !== undefined || env.PINGROOM_ROOM_ACCESS !== undefined) {
    raw = { token: env.PINGROOM_TOKEN, roomAccess: env.PINGROOM_ROOM_ACCESS };
  } else {
    try { raw = await readJson(path, 16_384); }
    catch { fail('invalid_connection', 'Run npm run connect or provide PINGROOM_TOKEN and PINGROOM_ROOM_ACCESS=all.'); }
  }
  if (!keys(raw, ['token', 'roomAccess']) || typeof raw.token !== 'string'
    || !/^[\x21-\x7e]{1,8192}$/.test(raw.token) || raw.roomAccess !== 'all') {
    fail('invalid_connection', 'Use a nonblank token and an explicit all-rooms grant. Partial environment overrides are rejected.');
  }
  return raw;
}
