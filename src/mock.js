import { PingRoom } from '@pingroom/sdk';
export const ownerId = '22222222-2222-4222-8222-222222222222';
export const roomId = '11111111-1111-4111-8111-111111111111';
export const input = { projectId: 'docs-portal', label: 'Docs portal', icon: 'bell', color: '#0391fe' };
export function makeRoom(request, overrides = {}) {
  return { id: roomId, owner_id: ownerId, type: 'standard', is_public: false,
    invite_code: 'DEMO42', ...request,
    members: [{ user_id: ownerId, room_id: roomId, role: 'owner' }], ...overrides };
}
export function mockServer({ initialRooms = [], failAfterCreate = false, rejectCreate = false, hiddenAfterCreate = false, mutateCreated = (room) => room } = {}) {
  const server = { calls: [], rooms: structuredClone(initialRooms), creates: 0, failAfterCreate, rejectCreate,
    hiddenAfterCreate, mutateCreated, catalog: { version: 3, icons: { bell: { file: 'bell.svg', tags: [] } }, categories: [] } };
  const fetch = async (url, init) => {
    const route = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    server.calls.push({ method: init.method, route, body });
    if (route === '/api/agent/room-icons' && init.method === 'GET') return Response.json(server.catalog);
    if (route === '/api/agent/rooms' && init.method === 'GET') return Response.json(server.hiddenAfterCreate && server.creates ? [] : server.rooms);
    if (route === '/api/agent/rooms' && init.method === 'POST') {
      server.creates++;
      if (server.rejectCreate) return Response.json({ code: 'room_limit_reached', message: 'Room limit.' }, { status: 402 });
      const room = server.mutateCreated(makeRoom(body));
      server.rooms.push(room);
      if (server.failAfterCreate) throw new Error('Simulated response loss after commit.');
      return Response.json(room, { status: 201 });
    }
    throw new Error('Unexpected mock route.');
  };
  server.client = new PingRoom({ token: 'offline-test-token', baseUrl: 'https://api.pingroom.io', timeoutMs: 1000, fetch });
  return server;
}
