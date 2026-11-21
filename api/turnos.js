// GET /api/turnos?p=diagnostico → días con turnos libres (hora argentina).
import { PRODUCTOS, DIAS_VISIBLES, calcularTurnos, gas, json, modoPrueba } from './_lib.js';

export default async function handler(req, res) {
  const producto = String(req.query?.p || '');
  if (!PRODUCTOS[producto]) return json(res, 400, { error: 'Propuesta desconocida.' });
  try {
    let ocupados = [], feriados = [];
    if (!modoPrueba()) {
      const ahora = Date.now();
      const r = await gas('ocupado', { desde: ahora, hasta: ahora + (DIAS_VISIBLES + 2) * 86400000 });
      ocupados = r.ocupados || [];
      feriados = r.feriados || [];
    }
    return json(res, 200, { prueba: modoPrueba(), dias: calcularTurnos(producto, ocupados, feriados) });
  } catch (e) {
    console.error(e);
    return json(res, 502, { error: 'No pude leer la agenda. Probá de nuevo en un rato.' });
  }
}
