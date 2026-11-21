// POST /api/reservar {p, inicio, nombre, email, whatsapp, medio, nota}
// Retiene el turno en el calendario y, con tarjeta, arma el pago de Mercado Pago.
import {
  PRODUCTOS, RETENCION_TARJETA_MIN, RETENCION_TRANSFERENCIA_H, SEMANAS_MAX_PACK, calcularSerie, firmar, gas, json,
  leerAgenda, leerCuerpo, modoPrueba, montos, mp, nuevoId, sitio, turnoPlausible,
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
  const ahora = Date.now();
  const ver = firmar('ver', id);

  // Niveles: las 8 fechas salen del mismo día y horario semanal.
  let inicios = [inicio];
  if (p.cantidad > 1) {
    const a = await leerAgenda(SEMANAS_MAX_PACK).catch(() => null);
    const serie = a && calcularSerie(b.p, inicio, a.disponibles || [], a.ocupados || [], a.feriados || []);
    if (!serie) return json(res, 409, { error: 'Ese horario ya no tiene lugar para los ' + p.cantidad + ' encuentros. Elegí otro.' });
    inicios = serie;
  }

  // Crédito del Diagnóstico (30 días), si corresponde a esta propuesta.
  let credito = 0;
  if (p.credito && !modoPrueba()) {
    try { credito = (await gas('credito', { email })).monto || 0; } catch (e) { console.error(e); }
  }
  const m = montos(p, medio, credito);
  const expira = medio === 'tarjeta'
    ? ahora + RETENCION_TARJETA_MIN * 60000
    : Math.min(ahora + RETENCION_TRANSFERENCIA_H * 3600000, inicios[0] - 3600000);

  if (modoPrueba()) return json(res, 200, { prueba: true, id, k: ver, medio, montos: m, fechas: inicios });

  try {
    const hold = await gas('retener', {
      id, expira,
      inicio: inicios[0], fin: inicios[0] + p.duracion * 60000, // compatibilidad con la versión anterior de Apps Script
      sesiones: inicios.map((s) => ({ inicio: s, fin: s + p.duracion * 60000 })),
      reserva: {
        producto: b.p, productoNombre: p.nombre, nombre, email, whatsapp, nota, origen, medio, duracion: p.duracion,
        total: m.total, ahora: m.ahora, saldo: m.saldo, creditoUsado: m.credito || 0,
      },
      confirmarUrl: `${sitio()}/api/confirmar?id=${id}&k=${firmar('confirmar', id)}`,
      verUrl: `${sitio()}/reservar/?id=${id}&k=${ver}`,
    });
    if (!hold.ok) return json(res, 409, { error: 'Ese horario se acaba de ocupar. Elegí otro.' });

    if (medio === 'transferencia') {
      return json(res, 200, { id, k: ver, medio, montos: m, fechas: inicios, transferencia: hold.transferencia });
    }

    const titulo = (p.sena < 1 ? `${p.nombre} · seña del ${Math.round(p.sena * 100)} %` : p.nombre) +
      (m.credito ? ' (con crédito del Diagnóstico)' : '');
    const pref = await mp('/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ id: b.p, title: `${titulo} · A Primera Vista`, quantity: 1, unit_price: m.ahora, currency_id: 'ARS' }],
        // En la versión de prueba no se precarga el mail: el modo prueba de Mercado Pago rechaza mails reales.
        ...(process.env.VERCEL_ENV === 'production' ? { payer: { name: nombre, email } } : {}),
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
    return json(res, 200, { id, k: ver, medio, montos: m, fechas: inicios, pagar: pref.init_point });
  } catch (e) {
    console.error(e);
    try { await gas('liberar', { id }); } catch {}
    return json(res, 502, { error: 'Algo falló al reservar. Probá de nuevo o escribime por WhatsApp.' });
  }
}
