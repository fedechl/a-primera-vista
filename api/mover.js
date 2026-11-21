// GET  /api/mover?id=…&k=…            → turnos libres para mover una reserva confirmada
// POST /api/mover {id, k, inicio}      → la mueve (24 h de aviso, hasta 2 veces; lo controla Apps Script)
import { PRODUCTOS, calcularTurnos, firmaValida, gas, json, leerAgenda, leerCuerpo, modoPrueba, turnoPlausible } from './_lib.js';

export default async function handler(req, res) {
  const b = req.method === 'POST' ? await leerCuerpo(req) : (req.query || {});
  if (!firmaValida('ver', b.id, b.k)) return json(res, 403, { error: 'Link inválido.' });
  try {
    if (modoPrueba()) {
      if (req.method === 'POST') return json(res, 200, { prueba: true, ok: true });
      const a = await leerAgenda();
      return json(res, 200, { prueba: true, producto: 'diagnostico', dias: calcularTurnos('diagnostico', a.disponibles, [], []) });
    }
    const r = await gas('estado', { id: b.id });
    if (r.estado !== 'confirmada' || !PRODUCTOS[r.productoClave]) return json(res, 409, { error: 'Esta reserva no se puede mover desde acá. Escribime por WhatsApp.' });
    if (req.method !== 'POST') {
      const a = await leerAgenda();
      return json(res, 200, { ...r, dias: calcularTurnos(r.productoClave, a.disponibles || [], a.ocupados || [], a.feriados || []) });
    }
    const inicio = Number(b.inicio);
    if (!turnoPlausible(inicio)) return json(res, 400, { error: 'Ese horario ya no está disponible. Elegí otro.' });
    const m = await gas('mover', { id: b.id, inicio, fin: inicio + PRODUCTOS[r.productoClave].duracion * 60000 });
    if (!m.ok) return json(res, 409, { error: m.motivo || 'No se pudo mover.' });
    return json(res, 200, m);
  } catch (e) {
    console.error(e);
    return json(res, 502, { error: 'Algo falló. Probá de nuevo o escribime por WhatsApp.' });
  }
}
