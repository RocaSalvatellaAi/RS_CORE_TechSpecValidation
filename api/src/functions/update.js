const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

const TABLE = 'techspecresponses';
// Table Storage limita cada propiedad string a 64 KB: troceamos el JSON en payload0..N
const CHUNK = 60000;
const MAX_BODY = 512 * 1024;

// POST /api/update  { client, id, state }
// Reescribe (edita) una respuesta ya guardada. Protegido por rol "rs"
// en staticwebapp.config.json. Lo usa el panel de admin para editar
// veredicto / alternativa / notas de cada requisito.
app.http('update', {
  methods: ['POST'],
  authLevel: 'anonymous', // el gate real lo pone SWA vía rol "rs" en la ruta
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { ok: false, error: 'JSON inválido' } };
    }

    const client = String(body.client || '').replace(/[^\w-]/g, '').slice(0, 64);
    const id = String(body.id || '').replace(/[^\w.:-]/g, '').slice(0, 128);
    const state = body && body.state;
    if (!client || !id) return { status: 400, jsonBody: { ok: false, error: 'Faltan client o id' } };
    if (!state || typeof state !== 'object') return { status: 400, jsonBody: { ok: false, error: 'Sin estado' } };

    const json = JSON.stringify(state);
    if (json.length > MAX_BODY) return { status: 413, jsonBody: { ok: false, error: 'Payload demasiado grande' } };

    const conn = process.env.STORAGE_CONNECTION_STRING;
    if (!conn) {
      context.warn('STORAGE_CONNECTION_STRING no configurada');
      return { status: 503, jsonBody: { ok: false, error: 'Almacén no configurado' } };
    }

    const table = TableClient.fromConnectionString(conn, TABLE);

    let existing;
    try {
      existing = await table.getEntity(client, id);
    } catch (e) {
      if (e.statusCode === 404) return { status: 404, jsonBody: { ok: false, error: 'Respuesta no encontrada' } };
      throw e;
    }

    // Quién edita (SWA inyecta la identidad en x-ms-client-principal, base64 JSON).
    let editedBy = '';
    try {
      const b = request.headers.get('x-ms-client-principal');
      if (b) editedBy = String((JSON.parse(Buffer.from(b, 'base64').toString('utf8')) || {}).userDetails || '').slice(0, 128);
    } catch { /* sin identidad legible */ }

    // Entidad nueva y limpia (modo Replace elimina los payload* antiguos que no se reenvíen).
    const entity = {
      partitionKey: client,
      rowKey: id,
      submittedAt: existing.submittedAt,
      pageUrl: existing.pageUrl,
      userAgent: existing.userAgent,
      answersCount: Object.keys(state).length,
      editedAt: new Date().toISOString(),
    };
    if (editedBy) entity.editedBy = editedBy;

    let parts = 0;
    for (let off = 0; off < json.length; off += CHUNK) {
      entity['payload' + parts] = json.slice(off, off + CHUNK);
      parts++;
    }
    entity.parts = parts;

    await table.updateEntity(entity, 'Replace');

    context.log(`TechSpec editada: cliente=${client} id=${id} por=${editedBy || 'desconocido'} (${entity.answersCount} respuestas)`);
    return { jsonBody: { ok: true, id, editedAt: entity.editedAt, editedBy } };
  },
});
