// GET /api/turnos?p=diagnostico → días con turnos libres (hora argentina).
// En los niveles, solo los horarios en los que entran los 8 encuentros semanales, con sus fechas.
import { PRODUCTOS, SEMANAS_MAX_PACK, calcularTurnos, json, leerAgenda, modoPrueba, turnosDePack } from './_lib.js';

export default async function handler(req, res) {
  const producto = String(req.query?.p || '');
  const p = PRODUCTOS[producto];
  if (!p) return json(res, 400, { error: 'Propuesta desconocida.' });
  try {
    if (p.cantidad > 1) {
      const a = await leerAgenda(SEMANAS_MAX_PACK);
      return json(res, 200, { prueba: modoPrueba(), ...turnosDePack(producto, a) });
    }
    const a = await leerAgenda();
    return json(res, 200, { prueba: modoPrueba(), dias: calcularTurnos(producto, a.disponibles || [], a.ocupados || [], a.feriados || []) });
  } catch (e) {
    console.error(e);
    return json(res, 502, { error: 'No pude leer la agenda. Probá de nuevo en un rato.' });
  }
}
