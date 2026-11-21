// T43 · Reservas propias de A Primera Vista (etapa 1: Diagnóstico y Encuentro a medida).
// Todo lo que es dato sensible (tokens, alias, link de Zoom) vive en las variables de entorno de Vercel.
// Sin GAS_URL, el sistema anda en "modo prueba": muestra turnos, no cobra ni agenda nada.
import crypto from 'node:crypto';

export const TZ_OFFSET_MIN = -180; // Argentina, UTC-3 todo el año

// Precios de 05 · Precios y reglas (válidos hasta el 15/01/2027). Si cambian, se cambian acá.
export const PRODUCTOS = {
  'diagnostico': {
    nombre: 'Diagnóstico',
    detalle: '30 minutos por Zoom: fragmentos cortos, de menos a más, y después una devolución escrita.',
    duracion: 30,
    tarjeta: 54400,
    transferencia: 50048,
    sena: 1, // se paga entero al reservar
  },
  'encuentro-a-medida': {
    nombre: 'Encuentro a medida',
    detalle: '1 hora por Zoom, con preparación previa con tu material, grabación, devolución escrita y prioridad de agenda.',
    duracion: 60,
    tarjeta: 99000,
    transferencia: 91080,
    sena: 0.1, // seña del 10 % al reservar
  },
};

// Horarios de trabajo (los mismos que en Agora). 1 = lunes … 5 = viernes. Horas en hora argentina.
export const HORARIOS = {
  1: [[9, 12], [13, 16]],
  3: [[9, 15]],
  5: [[9, 12], [13, 16]],
};
export const PASO_MIN = 60;          // los turnos arrancan cada 60 minutos
export const ANTICIPACION_H = 24;    // se reserva con 24 h de anticipación mínima
export const DIAS_VISIBLES = 21;     // cuántos días hacia adelante se muestran
export const RETENCION_TARJETA_MIN = 40;   // el turno queda retenido mientras paga
export const RETENCION_TRANSFERENCIA_H = 24;

export const env = (k, d = '') => process.env[k] || d;
export const modoPrueba = () => !env('GAS_URL');
export const sitio = () => env('SITE_URL', 'https://leeraprimeravista.com');

export function firmar(tipo, id) {
  return crypto.createHmac('sha256', env('GAS_SECRET', 'prueba')).update(tipo + ':' + id).digest('base64url').slice(0, 22);
}
export function firmaValida(tipo, id, k) {
  if (!id || !k) return false;
  const a = Buffer.from(firmar(tipo, id)); const b = Buffer.from(String(k));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const nuevoId = () => crypto.randomBytes(9).toString('base64url');

export function montos(p, medio) {
  const total = medio === 'transferencia' ? p.transferencia : p.tarjeta;
  const ahora = Math.round(total * p.sena);
  return { total, ahora, saldo: total - ahora };
}

// Lo que no se manda nunca al navegador va en cfg: viaja solo de Vercel a Apps Script.
export function cfg() {
  return {
    zoom: env('ZOOM_URL'),
    alias: env('TRANSFER_ALIAS'),
    cbu: env('TRANSFER_CBU'),
    titular: env('TRANSFER_TITULAR'),
    avisos: env('AVISOS_EMAIL'),
    muse: env('MUSE_EMAIL'),
    whatsapp: env('WHATSAPP', '5491178165441'),
    sitio: sitio(),
  };
}

export async function gas(accion, datos = {}) {
  const r = await fetch(env('GAS_URL'), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: env('GAS_SECRET'), accion, cfg: cfg(), ...datos }),
    redirect: 'follow',
  });
  const txt = await r.text();
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error('Apps Script no respondió JSON: ' + txt.slice(0, 200)); }
  if (j.error) throw new Error('Apps Script: ' + j.error);
  return j;
}

export async function mp(path, opciones = {}) {
  const r = await fetch('https://api.mercadopago.com' + path, {
    ...opciones,
    headers: {
      Authorization: 'Bearer ' + env('MP_ACCESS_TOKEN'),
      'Content-Type': 'application/json',
      ...(opciones.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Mercado Pago ' + r.status + ': ' + JSON.stringify(j).slice(0, 300));
  return j;
}

// Si el pago está aprobado, confirma la reserva (se puede llamar varias veces: Apps Script no duplica).
export async function confirmarSiAprobado(paymentId) {
  const pago = await mp('/v1/payments/' + encodeURIComponent(paymentId));
  if (pago.status !== 'approved' || !pago.external_reference) return { estado: pago.status };
  return gas('confirmar', {
    id: pago.external_reference,
    pago: { medio: 'tarjeta', monto: pago.transaction_amount, neto: pago.transaction_details?.net_received_amount ?? null, mpId: String(pago.id) },
  });
}

export function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export async function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const partes = [];
  for await (const c of req) partes.push(c);
  try { return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); } catch { return {}; }
}

// ---------- Cálculo de turnos ----------
// "Hora argentina" se representa como un Date UTC corrido 3 h, para usar getUTC* sin depender del servidor.
const aAR = (ms) => new Date(ms + TZ_OFFSET_MIN * 60000);
const desdeAR = (y, m, d, h, min) => Date.UTC(y, m, d, h, min) - TZ_OFFSET_MIN * 60000;

export function calcularTurnos(producto, ocupados, feriados, ahora = Date.now()) {
  const p = PRODUCTOS[producto];
  const desde = ahora + ANTICIPACION_H * 3600000;
  const feriadosSet = new Set(feriados); // 'AAAA-MM-DD'
  const dias = [];
  const hoy = aAR(ahora);
  for (let i = 0; i <= DIAS_VISIBLES; i++) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + i));
    const clave = d.toISOString().slice(0, 10);
    const bloques = HORARIOS[d.getUTCDay()];
    if (!bloques || feriadosSet.has(clave)) continue;
    const turnos = [];
    for (const [hIni, hFin] of bloques) {
      for (let min = hIni * 60; min + p.duracion <= hFin * 60; min += PASO_MIN) {
        const s = desdeAR(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, min);
        const e = s + p.duracion * 60000;
        if (s < desde) continue;
        if (ocupados.some((o) => s < o.e && e > o.s)) continue;
        turnos.push(s);
      }
    }
    if (turnos.length) dias.push({ fecha: clave, turnos });
  }
  return dias;
}

export function turnoValido(producto, inicio, ahora = Date.now()) {
  // El turno tiene que ser uno de los que se ofrecen (sin mirar el calendario: eso lo revisa Apps Script).
  return calcularTurnos(producto, [], [], ahora).some((d) => d.turnos.includes(inicio));
}
