// POST /api/mp · aviso de Mercado Pago. Siempre se vuelve a consultar el pago a la API de MP:
// no se confía en lo que trae el aviso.
import { confirmarSiAprobado, json, leerCuerpo, revisarReserva } from './_lib.js';

export default async function handler(req, res) {
  // GET /api/mp?revisar=CODIGO: vuelve a mirar en Mercado Pago si esa reserva tiene un pago aprobado.
  // Solo confirma lo que MP da por aprobado, así que no hace falta clave.
  if (req.method === 'GET' && req.query?.revisar) {
    try { return json(res, 200, await revisarReserva(String(req.query.revisar).slice(0, 40))); }
    catch (e) { console.error(e); return json(res, 502, { error: 'No pude consultar Mercado Pago.' }); }
  }
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
