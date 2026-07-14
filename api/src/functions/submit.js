const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

const TABLE = 'techspecresponses';
// Table Storage limita cada propiedad string a 64 KB: troceamos el JSON en payload0..N
const CHUNK = 60000;
const MAX_BODY = 512 * 1024;

app.http('submit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { ok: false, error: 'JSON inválido' } };
    }

    const state = body && body.state;
    if (!state || typeof state !== 'object' || Object.keys(state).length === 0) {
      return { status: 400, jsonBody: { ok: false, error: 'Sin respuestas' } };
    }
    const json = JSON.stringify(state);
    if (json.length > MAX_BODY) {
      return { status: 413, jsonBody: { ok: false, error: 'Payload demasiado grande' } };
    }

    const conn = process.env.STORAGE_CONNECTION_STRING;
    if (!conn) {
      context.warn('STORAGE_CONNECTION_STRING no configurada');
      return { status: 503, jsonBody: { ok: false, error: 'Almacén no configurado' } };
    }

    const clientId = String(body.client || '').replace(/[^\w-]/g, '').slice(0, 64) || 'anon';
    const now = new Date();
    const rowKey = now.toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8);

    const entity = {
      partitionKey: clientId,
      rowKey,
      submittedAt: now.toISOString(),
      answersCount: Object.keys(state).length,
      pageUrl: String(body.page || '').slice(0, 512),
      userAgent: (request.headers.get('user-agent') || '').slice(0, 256),
    };
    let parts = 0;
    for (let off = 0; off < json.length; off += CHUNK) {
      entity['payload' + parts] = json.slice(off, off + CHUNK);
      parts++;
    }
    entity.parts = parts;

    const table = TableClient.fromConnectionString(conn, TABLE);
    try {
      await table.createTable();
    } catch (e) {
      if (e.statusCode !== 409) throw e; // 409 = ya existe
    }
    await table.createEntity(entity);

    context.log(`TechSpec recibida: cliente=${clientId} id=${rowKey} (${json.length} bytes, ${entity.answersCount} respuestas)`);
    return { jsonBody: { ok: true, id: rowKey } };
  },
});
