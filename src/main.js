import { PingRoom } from '@pingroom/sdk';
import { resolve } from 'node:path';
import { API_URL, root, loadEnv, loadConnection } from './config.js';
import { readJson } from './storage.js';
import { provision } from './provision.js';
const controller = new AbortController();
let interrupted = 0;
for (const [event, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(event, () => { interrupted = code; controller.abort(); });
try {
  loadEnv();
  const [command, ...args] = process.argv.slice(2);
  if (!['plan', 'create', 'inspect', 'recover'].includes(command)
    || (['plan', 'inspect'].includes(command) && args.length)
    || (command === 'create' && args.length !== 1)
    || (command === 'recover' && ![0, 2].includes(args.length))) throw new Error('Invalid arguments.');
  const connection = await loadConnection();
  const input = await readJson(resolve(root, process.env.PROJECT_FILE ?? 'project.json'), 8192);
  const directory = resolve(root, process.env.PROJECT_STATE_DIR ?? '.projects');
  const result = await provision({ client: new PingRoom({ token: connection.token, baseUrl: API_URL, timeoutMs: 5000 }),
    ...connection, input, directory, command, planHash: args[0],
    ...(command === 'recover' ? { roomId: args[0], ownerId: args[1] } : {}), signal: controller.signal });
  // Keep invite codes out of stdout, which CI systems may collect.
  console.log(JSON.stringify({ projectId: input.projectId, status: result.status, planHash: result.planHash,
    request: result.request, verifiedAt: result.verifiedAt ?? null, journal: `${input.projectId}.json`, localOnly: result.localOnly ?? false,
    ...(result.candidates ? { candidates: result.candidates } : {}) }, null, 2));
  if (result.status === 'planned') console.log(`Review this plan. Create exactly this room with: npm run create -- ${result.planHash}`);
  if (result.status === 'verified') console.log('Verified at the recorded observation. The private journal contains the room UUID and invite link.');
} catch (error) {
  console.error(error.name === 'ProjectError' ? `${error.code}: ${error.message}` : 'Operation failed; check configuration, connection, and the saved project journal.');
  process.exitCode = interrupted || (error.code === 'creation_unresolved' ? 2 : 1);
}
