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

// POST /api/delete  { client, id }
// Elimina una respuesta guardada. Protegido por rol "admin" en
// staticwebapp.config.json. Lo usa el panel de admin.
app.http('delete', {
  methods: ['POST'],
  authLevel: 'anonymous', // el gate real lo pone SWA vía rol "admin" en la ruta
  handler: async (request, context) => {
    if (!hasRole(request, 'admin')) {
      return { status: 403, jsonBody: { ok: false, error: 'Solo un administrador puede eliminar' } };
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { ok: false, error: 'JSON inválido' } };
    }

    const client = String(body.client || '').replace(/[^\w-]/g, '').slice(0, 64);
    const id = String(body.id || '').replace(/[^\w.:-]/g, '').slice(0, 128);
    if (!client || !id) return { status: 400, jsonBody: { ok: false, error: 'Faltan client o id' } };

    const conn = process.env.STORAGE_CONNECTION_STRING;
    if (!conn) {
      context.warn('STORAGE_CONNECTION_STRING no configurada');
      return { status: 503, jsonBody: { ok: false, error: 'Almacén no configurado' } };
    }

    const table = TableClient.fromConnectionString(conn, TABLE);
    try {
      await table.deleteEntity(client, id);
    } catch (e) {
      if (e.statusCode === 404) return { status: 404, jsonBody: { ok: false, error: 'Respuesta no encontrada' } };
      throw e;
    }

    context.log(`TechSpec eliminada: cliente=${client} id=${id}`);
    return { jsonBody: { ok: true, id } };
  },
});
