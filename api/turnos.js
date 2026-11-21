// GET /api/turnos?p=diagnostico → días con turnos libres (hora argentina).
import { PRODUCTOS, calcularTurnos, json, leerAgenda, modoPrueba } from './_lib.js';

export default async function handler(req, res) {
  const producto = String(req.query?.p || '');
  if (!PRODUCTOS[producto]) return json(res, 400, { error: 'Propuesta desconocida.' });
  try {
    const a = await leerAgenda();
    return json(res, 200, { prueba: modoPrueba(), dias: calcularTurnos(producto, a.disponibles || [], a.ocupados || [], a.feriados || []) });
  } catch (e) {
    console.error(e);
    return json(res, 502, { error: 'No pude leer la agenda. Probá de nuevo en un rato.' });
  }
}
