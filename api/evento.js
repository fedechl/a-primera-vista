// POST /api/evento {sesion, paso, propuesta, detalle, origen} · un paso del embudo de la página de reservas.
// Anónimo: la sesión es un número al azar de esa pestaña. Queda en 02 › Captación · Reservas web.
import { gas, leerCuerpo, modoPrueba } from './_lib.js';

const PASOS = ['Entró', 'Puso la fecha de audición', 'Vio horarios', 'Eligió horario', 'Revisó acceso', 'Pidió acceso', 'Envió la reserva', 'Error', 'Fue a suscribirse al Club'];
const corto = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

export default async function handler(req, res) {
  res.statusCode = 204;
  if (req.method !== 'POST') return res.end();
  let b = await leerCuerpo(req);
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  if (!PASOS.includes(b.paso) || modoPrueba()) return res.end();
  try {
    await gas('evento', { sesion: corto(b.sesion, 24), paso: b.paso, propuesta: corto(b.propuesta, 40), detalle: corto(b.detalle, 120), origen: corto(b.origen, 60) });
  } catch (e) { console.error(e); }
  return res.end();
}
