// POST /api/mp · aviso de Mercado Pago. Siempre se vuelve a consultar el pago a la API de MP:
// no se confía en lo que trae el aviso.
import { confirmarSiAprobado, json, leerCuerpo } from './_lib.js';

export default async function handler(req, res) {
  const b = await leerCuerpo(req);
  const tipo = b.type || b.topic || req.query?.type || req.query?.topic;
  const pid = b.data?.id || req.query?.['data.id'] || (tipo === 'payment' ? req.query?.id : null);
  if (tipo !== 'payment' || !pid) return json(res, 200, { ok: true, ignorado: true });
  try {
    const r = await confirmarSiAprobado(pid);
    return json(res, 200, { ok: true, estado: r.estado || 'confirmada' });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'reintentar' }); // MP vuelve a avisar
  }
}
