const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

const TABLE = 'techspecresponses';

// Reconstruye el JSON troceado (payload0..N) de una entidad en su objeto de estado.
function rebuild(entity) {
  const parts = entity.parts || 0;
  let json = '';
  for (let i = 0; i < parts; i++) json += entity['payload' + i] || '';
  let state = {};
  try { state = JSON.parse(json); } catch { /* deja {} si corrupto */ }
  return {
    client: entity.partitionKey,
    id: entity.rowKey,
    submittedAt: entity.submittedAt,
    editedAt: entity.editedAt || null,
    editedBy: entity.editedBy || null,
    answersCount: entity.answersCount,
    pageUrl: entity.pageUrl,
    state,
  };
}

// GET /api/responses            → todas las respuestas
// GET /api/responses?client=x   → solo las de ese cliente
// Protegido por staticwebapp.config.json (rol "rs").
app.http('responses', {
  methods: ['GET'],
  authLevel: 'anonymous', // el gate real lo pone SWA vía roles en la ruta
  handler: async (request, context) => {
    const conn = process.env.STORAGE_CONNECTION_STRING;
    if (!conn) return { status: 503, jsonBody: { ok: false, error: 'Almacén no configurado' } };

    const client = (request.query.get('client') || '').replace(/[^\w-]/g, '').slice(0, 64);
    const table = TableClient.fromConnectionString(conn, TABLE);

    const items = [];
    try {
      const filter = client ? { queryOptions: { filter: `PartitionKey eq '${client}'` } } : undefined;
      for await (const e of table.listEntities(filter)) items.push(rebuild(e));
    } catch (e) {
      if (e.statusCode === 404) return { jsonBody: { ok: true, responses: [] } }; // tabla aún no creada
      throw e;
    }
    items.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    return { jsonBody: { ok: true, count: items.length, responses: items } };
  },
});
