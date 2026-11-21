// POST /api/reservar {p, inicio, nombre, email, whatsapp, medio, nota}
// Retiene el turno en el calendario y, con tarjeta, arma el pago de Mercado Pago.
import {
  PRODUCTOS, RETENCION_TARJETA_MIN, RETENCION_TRANSFERENCIA_H, firmar, gas, json, leerCuerpo,
  modoPrueba, montos, mp, nuevoId, sitio, turnoPlausible,
} from './_lib.js';

const limpiar = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido.' });
  const b = await leerCuerpo(req);
  const p = PRODUCTOS[b.p];
  const inicio = Number(b.inicio);
  const nombre = limpiar(b.nombre, 80);
  const email = limpiar(b.email, 120).toLowerCase();
  const whatsapp = limpiar(b.whatsapp, 30);
  const nota = limpiar(b.nota, 500);
  const ORIGENES = ['Recomendación', 'Instagram', 'YouTube', 'Flyer', 'Grupo de músicos o coro', 'Google', 'Otro', 'Ya trabajé con Fede'];
  const origen = ORIGENES.includes(b.origen) ? b.origen : '';
  const medio = b.medio === 'transferencia' ? 'transferencia' : 'tarjeta';

  if (!p) return json(res, 400, { error: 'Propuesta desconocida.' });
  if (!nombre || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || whatsapp.replace(/\D/g, '').length < 8)
    return json(res, 400, { error: 'Revisá tu nombre, tu mail y tu WhatsApp.' });
  if (!turnoPlausible(inicio)) return json(res, 400, { error: 'Ese horario ya no está disponible. Elegí otro.' });

  const id = nuevoId();
  const m = montos(p, medio);
  const ahora = Date.now();
  const expira = medio === 'tarjeta'
    ? ahora + RETENCION_TARJETA_MIN * 60000
    : Math.min(ahora + RETENCION_TRANSFERENCIA_H * 3600000, inicio - 3600000);
  const ver = firmar('ver', id);

  if (modoPrueba()) return json(res, 200, { prueba: true, id, k: ver, medio, montos: m });

  try {
    const hold = await gas('retener', {
      id, inicio, fin: inicio + p.duracion * 60000, expira,
      reserva: { producto: b.p, productoNombre: p.nombre, nombre, email, whatsapp, nota, origen, medio, ...m },
      confirmarUrl: `${sitio()}/api/confirmar?id=${id}&k=${firmar('confirmar', id)}`,
      verUrl: `${sitio()}/reservar/?id=${id}&k=${ver}`,
    });
    if (!hold.ok) return json(res, 409, { error: 'Ese horario se acaba de ocupar. Elegí otro.' });

    if (medio === 'transferencia') {
      return json(res, 200, { id, k: ver, medio, montos: m, transferencia: hold.transferencia });
    }

    const titulo = p.sena < 1 ? `${p.nombre} · seña del ${Math.round(p.sena * 100)} %` : p.nombre;
    const pref = await mp('/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ id: b.p, title: `${titulo} · A Primera Vista`, quantity: 1, unit_price: m.ahora, currency_id: 'ARS' }],
        payer: { name: nombre, email },
        external_reference: id,
        statement_descriptor: 'APRIMERAVISTA',
        notification_url: `${sitio()}/api/mp`,
        back_urls: {
          success: `${sitio()}/reservar/?id=${id}&k=${ver}`,
          pending: `${sitio()}/reservar/?id=${id}&k=${ver}`,
          failure: `${sitio()}/reservar/?p=${b.p}&fallo=1`,
        },
        auto_return: 'approved',
        payment_methods: { installments: 1, excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
        expires: true,
        expiration_date_to: new Date(expira - 5 * 60000).toISOString(),
      }),
    });
    return json(res, 200, { id, k: ver, medio, montos: m, pagar: pref.init_point });
  } catch (e) {
    console.error(e);
    try { await gas('liberar', { id }); } catch {}
    return json(res, 502, { error: 'Algo falló al reservar. Probá de nuevo o escribime por WhatsApp.' });
  }
}
