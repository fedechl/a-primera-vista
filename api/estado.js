// GET /api/estado?id=…&k=…[&payment_id=…] · lo consulta la página al volver de Mercado Pago.
import { confirmarSiAprobado, firmaValida, gas, json, modoPrueba } from './_lib.js';

export default async function handler(req, res) {
  const { id, k, payment_id } = req.query || {};
  if (!firmaValida('ver', id, k)) return json(res, 403, { error: 'Link inválido.' });
  if (modoPrueba()) return json(res, 200, { prueba: true, estado: 'confirmada' });
  try {
    if (payment_id && /^\d+$/.test(String(payment_id))) {
      try { await confirmarSiAprobado(payment_id); } catch (e) { console.error(e); }
    }
    return json(res, 200, await gas('estado', { id }));
  } catch (e) {
    console.error(e);
    return json(res, 502, { error: 'No pude consultar la reserva.' });
  }
}
