const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

const TABLE = 'techspecresponses';

// Defensa en profundidad: la ruta ya exige rol "admin" en staticwebapp.config.json,
// pero validamos también aquí por si la Function se invoca sin pasar por el proxy de SWA.
function hasRole(request, role) {
  try {
    const b = request.headers.get('x-ms-client-principal');
    if (!b) return false;
    const p = JSON.parse(Buffer.from(b, 'base64').toString('utf8')) || {};
    return Array.isArray(p.userRoles) && p.userRoles.includes(role);
  } catch { return false; }
}

// POST /api/purge  { keep: ["LANDER", ...] }
// Elimina TODAS las respuestas cuyo cliente (partitionKey) no esté en `keep`.
// Operación destructiva de limpieza. Protegido por rol "admin" en
// staticwebapp.config.json. Lo usa el botón «Depurar» del panel de admin.
app.http('purge', {
  methods: ['POST'],
  authLevel: 'anonymous', // el gate real lo pone SWA vía rol "admin" en la ruta
  handler: async (request, context) => {
    if (!hasRole(request, 'admin')) {
      return { status: 403, jsonBody: { ok: false, error: 'Solo un administrador puede depurar' } };
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { ok: false, error: 'JSON inválido' } };
    }

    let keep = Array.isArray(body.keep) ? body.keep : (body.keep ? [body.keep] : []);
    keep = keep.map(k => String(k || '').replace(/[^\w-]/g, '').slice(0, 64)).filter(Boolean);
    if (!keep.length) {
      return { status: 400, jsonBody: { ok: false, error: 'Indica al menos un cliente a conservar (keep)' } };
    }

    const conn = process.env.STORAGE_CONNECTION_STRING;
    if (!conn) {
      context.warn('STORAGE_CONNECTION_STRING no configurada');
      return { status: 503, jsonBody: { ok: false, error: 'Almacén no configurado' } };
    }

    const table = TableClient.fromConnectionString(conn, TABLE);
    const keepSet = new Set(keep);
    const toDelete = [];
    let kept = 0;
    try {
      for await (const e of table.listEntities()) {
        if (keepSet.has(e.partitionKey)) kept++;
        else toDelete.push({ pk: e.partitionKey, rk: e.rowKey });
      }
    } catch (e) {
      if (e.statusCode === 404) return { jsonBody: { ok: true, deleted: 0, kept: 0, keep } }; // tabla vacía
      throw e;
    }

    let deleted = 0;
    for (const d of toDelete) {
      try {
        await table.deleteEntity(d.pk, d.rk);
        deleted++;
      } catch (e) {
        if (e.statusCode !== 404) throw e;
      }
    }

    context.log(`TechSpec purge: conservadas=${kept} eliminadas=${deleted} keep=${keep.join(',')}`);
    return { jsonBody: { ok: true, deleted, kept, keep } };
  },
});
