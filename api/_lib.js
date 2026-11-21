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
  // Navegar la Partitura: 8 encuentros semanales en el mismo día y horario, pagados al reservar.
  'nivel-1': { nombre: 'Navegar la Partitura · Nivel 1', duracion: 60, cantidad: 8, tarjeta: 538000, transferencia: 494960, sena: 1, credito: true },
  'nivel-2': { nombre: 'Navegar la Partitura · Nivel 2', duracion: 60, cantidad: 8, tarjeta: 538000, transferencia: 494960, sena: 1, credito: true, requiere: 1 },
  'nivel-3': { nombre: 'Navegar la Partitura · Nivel 3', duracion: 60, cantidad: 8, tarjeta: 538000, transferencia: 494960, sena: 1, credito: true, requiere: 2 },
  // Kit de Audición: encuentros semanales + 4 simulacros de viernes (30 min), todo antes de la audición.
  // Un solo cambio, dentro de la misma semana (05 · Precios y reglas).
  'kit-express': { nombre: 'Kit de Audición · Express', duracion: 60, cantidad: 4, simulacros: 4, semanasMin: 3, tarjeta: 418500, transferencia: 385020, sena: 1, kit: true, maxMov: 1, mismaSemana: true },
  'kit-calma': { nombre: 'Kit de Audición · Calma', duracion: 60, cantidad: 8, simulacros: 4, semanasMin: 8, tarjeta: 609700, transferencia: 560924, sena: 1, kit: true, maxMov: 1, mismaSemana: true },
  'kit-puente': { nombre: 'Kit de Audición · Puente', duracion: 60, cantidad: 12, simulacros: 4, semanasMin: 12, tarjeta: 848800, transferencia: 780896, sena: 1, kit: true, maxMov: 1, mismaSemana: true },
};
export const SEMANAS_MAX_PACK = 10; // el nivel se completa dentro de las 10 semanas
export const DURACION_SIMULACRO = 30;

// Qué Kit corresponde según cuántas semanas faltan para la audición (04 › P05).
export function kitParaSemanas(semanas) {
  if (semanas < 3) return null;
  if (semanas < 8) return 'kit-express';
  if (semanas < 12) return 'kit-calma';
  return 'kit-puente';
}
// 'AAAA-MM-DD' → medianoche de ese día en Argentina (ms). La audición es ese día: todo tiene que ser antes.
export function audicionMs(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ_OFFSET_MIN * 60000 : null;
}

// La disponibilidad sale del calendario «APV · Disponibilidad» de Fede (se edita semana a semana).
// Estos horarios son solo los de muestra del modo prueba (lunes a viernes de 9 a 16). 1 = lunes … 5 = viernes.
export const HORARIOS_PRUEBA = { 1: [[9, 16]], 2: [[9, 16]], 3: [[9, 16]], 4: [[9, 16]], 5: [[9, 16]] };
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

// credito: monto a descontar (el 8 % por transferencia se calcula sobre el precio publicado, después se resta el crédito).
export function montos(p, medio, credito = 0) {
  const total = Math.max(0, (medio === 'transferencia' ? p.transferencia : p.tarjeta) - credito);
  const ahora = Math.round(total * p.sena);
  return { total, ahora, saldo: total - ahora, credito };
}

// Lo que no se manda nunca al navegador va en cfg: viaja solo de Vercel a Apps Script.
export function cfg() {
  return {
    zoom: env('ZOOM_URL'),
    alias: env('TRANSFER_ALIAS'),
    cbu: env('TRANSFER_CBU'),
    cbuEtiqueta: env('TRANSFER_CBU_ETIQUETA', 'CBU'),
    titular: env('TRANSFER_TITULAR'),
    avisos: env('AVISOS_EMAIL'),
    muse: env('MUSE_EMAIL'),
    ventas: env('VENTAS_SHEET_ID'),
    feriadosSheet: env('FERIADOS_SHEET_ID', '1cfg2D4-ls6NxlmFelWq917sHNc8iDM6nxEr00oMUkJY'),
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

// Busca en Mercado Pago un pago aprobado de esa reserva (por si el aviso de MP no llegó).
export async function revisarReserva(id) {
  const r = await mp('/v1/payments/search?sort=date_created&criteria=desc&external_reference=' + encodeURIComponent(id));
  const pago = (r.results || []).find((x) => x.status === 'approved');
  return pago ? confirmarSiAprobado(pago.id) : { estado: 'sin pago aprobado' };
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

export function bloquesDePrueba(semanasExtra = 0, ahora = Date.now()) {
  const hoy = aAR(ahora), bloques = [];
  for (let i = 0; i <= DIAS_VISIBLES + 1 + semanasExtra * 7; i++) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + i));
    for (const [a, b] of HORARIOS_PRUEBA[d.getUTCDay()] || []) {
      bloques.push({ s: desdeAR(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), a, 0), e: desdeAR(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), b, 0) });
    }
  }
  return bloques;
}

// disponibles: bloques en los que Fede atiende. ocupados: todo lo que bloquea. feriados: 'AAAA-MM-DD'.
export function calcularTurnos(producto, disponibles, ocupados, feriados, ahora = Date.now()) {
  const p = PRODUCTOS[producto];
  const desde = ahora + ANTICIPACION_H * 3600000;
  const hasta = ahora + (DIAS_VISIBLES + 1) * 86400000;
  const feriadosSet = new Set(feriados);
  const turnos = new Set();
  for (const b of disponibles) {
    for (let s = b.s; s + p.duracion * 60000 <= b.e; s += PASO_MIN * 60000) {
      const e = s + p.duracion * 60000;
      if (s < desde || s > hasta) continue;
      if (feriadosSet.has(aAR(s).toISOString().slice(0, 10))) continue;
      if (ocupados.some((o) => s < o.e && e > o.s)) continue;
      turnos.add(s);
    }
  }
  const dias = new Map();
  [...turnos].sort((a, b) => a - b).forEach((s) => {
    const clave = aAR(s).toISOString().slice(0, 10);
    if (!dias.has(clave)) dias.set(clave, []);
    dias.get(clave).push(s);
  });
  return [...dias].map(([fecha, t]) => ({ fecha, turnos: t }));
}

// Control rápido antes de ir al calendario (que es quien tiene la última palabra).
export function turnoPlausible(inicio, ahora = Date.now()) {
  return Number.isFinite(inicio) && inicio % (15 * 60000) === 0 &&
    inicio >= ahora + ANTICIPACION_H * 3600000 && inicio <= ahora + (DIAS_VISIBLES + 2) * 86400000;
}

export async function leerAgenda(semanasExtra = 0) {
  if (modoPrueba()) return { disponibles: bloquesDePrueba(semanasExtra), ocupados: [], feriados: [] };
  const ahora = Date.now();
  return gas('ocupado', { desde: ahora, hasta: ahora + (DIAS_VISIBLES + 2 + semanasExtra * 7) * 86400000 });
}

// Un nivel: el mismo día y horario cada semana. Si una semana no se puede (feriado, vacaciones, algo
// en el calendario), se pasa a la siguiente. Si no entran los 8 en 10 semanas, ese horario no se ofrece.
export function calcularSerie(producto, inicio, disponibles, ocupados, feriados) {
  const p = PRODUCTOS[producto];
  const feriadosSet = new Set(feriados);
  const libre = (s) => {
    const e = s + p.duracion * 60000;
    return !feriadosSet.has(aAR(s).toISOString().slice(0, 10)) &&
      disponibles.some((d) => s >= d.s && e <= d.e) &&
      !ocupados.some((o) => s < o.e && e > o.s);
  };
  const serie = [];
  for (let w = 0; w < SEMANAS_MAX_PACK && serie.length < p.cantidad; w++) {
    const s = inicio + w * 7 * 86400000;
    if (libre(s)) serie.push(s);
  }
  return serie.length === p.cantidad ? serie : null;
}

// Kit (como 08 · Calendarios del Kit de Audición): el plan se arma hacia atrás desde la audición.
// Tramo intensivo: los 4 viernes antes de la audición (simulacros, 30 min) y, en esas mismas semanas,
// un encuentro en el día y horario elegidos (si ese día no se puede, otro día de esa semana antes del viernes).
// Base: los encuentros que faltan, desde el inicio elegido, cada 1 o 2 semanas, el mismo día y horario.
// Express con 3 semanas: 3 simulacros y el encuentro que falta, dos días después del primero.
function libreEn(a, s, dur, extra = []) {
  const e = s + dur * 60000;
  return !new Set(a.feriados || []).has(aAR(s).toISOString().slice(0, 10)) &&
    (a.disponibles || []).some((d) => s >= d.s && e <= d.e) &&
    !(a.ocupados || []).some((o) => s < o.e && e > o.s) &&
    !extra.some((o) => s < o.e && e > o.s);
}
const DIA = 86400000, SEMANA = 7 * DIA;
const lunesDe = (ms) => { const d = aAR(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)) - TZ_OFFSET_MIN * 60000; };
export function planKit(producto, inicio, simMin, audicion, a) {
  const p = PRODUCTOS[producto];
  const ahora = Date.now() + 24 * 3600000;
  const offsetEnSemana = inicio - lunesDe(inicio); // día y hora elegidos, dentro de la semana
  const usados = [];
  const ocupa = (s, dur) => usados.push({ s, e: s + dur * 60000 });
  // 1. Simulacros: viernes antes de la audición, hacia atrás.
  const sims = [];
  let lunesAud = lunesDe(audicion - 1);
  for (let w = 0; sims.length < p.simulacros && w < 8; w++) {
    const s = lunesAud - w * SEMANA + 4 * DIA + simMin * 60000;
    if (s + DURACION_SIMULACRO * 60000 > audicion) continue;
    if (s < Math.max(ahora, lunesDe(inicio))) break;
    if (libreEn(a, s, DURACION_SIMULACRO)) { sims.unshift(s); ocupa(s, DURACION_SIMULACRO); }
  }
  const express3 = producto === 'kit-express' && sims.length === 3;
  if (sims.length < p.simulacros && !express3) return null;
  // 2. Encuentros del tramo intensivo, en las semanas de los simulacros.
  const intensivos = [];
  for (const sm of sims) {
    const lun = lunesDe(sm);
    const candidatos = [lun + offsetEnSemana, lun + 2 * DIA + (offsetEnSemana % DIA), lun + (offsetEnSemana % DIA), lun + DIA + (offsetEnSemana % DIA), lun + 3 * DIA + (offsetEnSemana % DIA), lun + 4 * DIA + (offsetEnSemana % DIA)];
    const s = candidatos.find((c) => c >= ahora && c >= inicio - DIA && c + p.duracion * 60000 <= audicion && libreEn(a, c, p.duracion, usados));
    if (s == null) return null;
    intensivos.push(s); ocupa(s, p.duracion);
  }
  if (express3) { // el encuentro que falta: dos días después del primero, mismo horario
    const s = intensivos[0] + 2 * DIA;
    if (!(s < sims[0] || lunesDe(s) === lunesDe(sims[0])) || !libreEn(a, s, p.duracion, usados)) return null;
    intensivos.push(s); ocupa(s, p.duracion);
    intensivos.sort((x, y) => x - y);
  }
  // 3. Base: desde el inicio elegido, cada 1 o 2 semanas, antes del tramo intensivo.
  const base = [];
  const cantBase = p.cantidad - intensivos.length;
  if (cantBase > 0) {
    const finBase = lunesDe(Math.min(...sims, ...intensivos));
    const semanasBase = Math.floor((finBase - lunesDe(inicio)) / SEMANA);
    if (semanasBase < cantBase) return null;
    const paso = Math.min(2, Math.floor(semanasBase / cantBase));
    let w = 0;
    while (base.length < cantBase && lunesDe(inicio) + w * SEMANA < finBase) {
      const s = inicio + w * SEMANA;
      if (libreEn(a, s, p.duracion, usados)) { base.push(s); ocupa(s, p.duracion); w += paso; } else w += 1;
    }
    if (base.length < cantBase) return null;
  } else if (lunesDe(inicio) > lunesDe(intensivos[0])) return null;
  return { encuentros: [...base, ...intensivos].sort((x, y) => x - y), simulacros: sims };
}
export function turnosDeKit(producto, audicion, a) {
  const dias = calcularTurnos(producto, a.disponibles || [], a.ocupados || [], a.feriados || []);
  const out = [], series = {}, sims = {};
  for (const d of dias) {
    const t = d.turnos.filter((s) => {
      const opciones = {};
      for (let m = 6 * 60; m <= 21 * 60; m += 30) {
        const plan = planKit(producto, s, m, audicion, a);
        if (plan) { opciones[m] = plan.simulacros; series[s] = plan.encuentros; }
      }
      if (Object.keys(opciones).length) { sims[s] = opciones; return true; }
      return false;
    });
    if (t.length) out.push({ fecha: d.fecha, turnos: t });
  }
  return { dias: out, series, sims };
}

export function turnosDePack(producto, a) {
  const dias = calcularTurnos(producto, a.disponibles || [], a.ocupados || [], a.feriados || []);
  const series = {};
  const out = [];
  for (const d of dias) {
    const t = d.turnos.filter((s) => {
      const serie = calcularSerie(producto, s, a.disponibles || [], a.ocupados || [], a.feriados || []);
      if (serie) series[s] = serie;
      return !!serie;
    });
    if (t.length) out.push({ fecha: d.fecha, turnos: t });
  }
  return { dias: out, series };
}
