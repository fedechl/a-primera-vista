/**
 * APV · Reservas (T43) · puente entre leeraprimeravista.com y la cuenta de Google de Fede.
 *
 * Corre como Fede: lee su Google Calendar para saber qué está ocupado, crea y confirma los
 * eventos de cada reserva (en rojo, como las clases), invita al músico y manda los mails.
 * No guarda datos sensibles: el link de Zoom, el alias y los mails le llegan desde Vercel en cada pedido.
 *
 * Instalación (una sola vez): pegar este archivo y appsscript.json en un proyecto nuevo de
 * script.google.com, correr instalar() y publicar como aplicación web (Ejecutar como: yo;
 * Acceso: cualquier persona). instalar() deja en el registro la clave para Vercel (GAS_SECRET).
 */

var TZ = 'America/Argentina/Buenos_Aires';
var FERIADOS_CAL = 'es.ar#holiday@group.v.calendar.google.com';
var COLOR_CLASES = '11';   // Tomate: el rojo de las clases en el calendario de Fede
var MARGEN_TRASLADO_MIN = 30;
var CAL_DISPONIBILIDAD = 'APV · Disponibilidad';
var MAX_MOVIMIENTOS = 2;
var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ---------- Instalación ----------
function instalar() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['limpiar', 'recordatorios'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('limpiar').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('recordatorios').timeBased().everyHours(1).create();
  calendarioDisponibilidad();
  Calendar.Events.list('primary', { maxResults: 1 }); // pide los permisos de Calendar de una vez
  Logger.log('GAS_SECRET para Vercel: ' + props.getProperty('SECRET'));
}

// El calendario donde Fede marca cuándo atiende. Se crea una vez con los mismos horarios que tenía
// Agora (lunes y viernes 9-12 y 13-16, miércoles 9-15), como eventos que se repiten cada semana:
// para cambiar una semana, se mueve, se acorta o se borra ese bloque solo en esa semana.
function calendarioDisponibilidad() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CAL_DISP');
  var cal = id && CalendarApp.getCalendarById(id);
  if (cal) return cal;
  cal = CalendarApp.createCalendar(CAL_DISPONIBILIDAD, { color: CalendarApp.Color.YELLOW, timeZone: TZ });
  props.setProperty('CAL_DISP', cal.getId());
  var hoy = new Date(), lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - ((hoy.getDay() + 6) % 7) + 7);
  [[0, 9, 12], [0, 13, 16], [2, 9, 15], [4, 9, 12], [4, 13, 16]].forEach(function (b) {
    var d = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + b[0]);
    var ini = new Date(d.getFullYear(), d.getMonth(), d.getDate(), b[1]), fin = new Date(d.getFullYear(), d.getMonth(), d.getDate(), b[2]);
    cal.createEventSeries('Disponible', ini, fin, CalendarApp.newRecurrence().addWeeklyRule());
  });
  return cal;
}

// ---------- Entrada ----------
function doPost(e) {
  var salida;
  try {
    var b = JSON.parse(e.postData.contents);
    if (!b.secret || b.secret !== PropertiesService.getScriptProperties().getProperty('SECRET')) throw new Error('clave inválida');
    var acciones = { ocupado: ocupado, retener: retener, confirmar: confirmar, estado: estado, liberar: liberar, mover: mover, credito: credito };
    if (!acciones[b.accion]) throw new Error('acción desconocida');
    salida = acciones[b.accion](b);
  } catch (err) {
    salida = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(salida)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('APV · Reservas').setMimeType(ContentService.MimeType.TEXT);
}

// ---------- Agenda ----------
// Todo lo que bloquea un turno: eventos de los calendarios propios de Fede (salvo los marcados como
// "libre", los cancelados y los que rechazó), con media hora antes y después si el evento tiene una
// dirección física (traslado). Los feriados bloquean el día entero.
function ocupado(b) {
  var desde = new Date(Number(b.desde)), hasta = new Date(Number(b.hasta));
  var ocupados = [], disponibles = [];
  var dispId = PropertiesService.getScriptProperties().getProperty('CAL_DISP');
  CalendarApp.getAllOwnedCalendars().forEach(function (cal) {
    var token, esDisp = cal.getId() === dispId;
    do {
      var r = Calendar.Events.list(cal.getId(), {
        timeMin: desde.toISOString(), timeMax: hasta.toISOString(),
        singleEvents: true, maxResults: 2500, pageToken: token,
      });
      (r.items || []).forEach(function (ev) {
        if (ev.status === 'cancelled') return;
        if (esDisp) {
          if (ev.start.dateTime) disponibles.push({ s: new Date(ev.start.dateTime).getTime(), e: new Date(ev.end.dateTime).getTime() });
          return;
        }
        if (b.sinId && ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.apv_id === b.sinId) return;
        if (ev.transparency === 'transparent') return;
        var yo = (ev.attendees || []).filter(function (a) { return a.self; })[0];
        if (yo && yo.responseStatus === 'declined') return;
        var s, f;
        if (ev.start.dateTime) {
          s = new Date(ev.start.dateTime).getTime(); f = new Date(ev.end.dateTime).getTime();
        } else { // evento de día completo marcado como ocupado (vacaciones, viajes)
          s = new Date(ev.start.date + 'T00:00:00-03:00').getTime(); f = new Date(ev.end.date + 'T00:00:00-03:00').getTime();
        }
        if (ev.location && !/zoom|meet\.google|https?:|virtual|online/i.test(ev.location)) {
          s -= MARGEN_TRASLADO_MIN * 60000; f += MARGEN_TRASLADO_MIN * 60000;
        }
        ocupados.push({ s: s, e: f });
      });
      token = r.nextPageToken;
    } while (token);
  });
  return { disponibles: disponibles, ocupados: ocupados, feriados: feriados(desde, hasta) };
}

function feriados(desde, hasta) {
  try {
    var r = Calendar.Events.list(FERIADOS_CAL, { timeMin: desde.toISOString(), timeMax: hasta.toISOString(), singleEvents: true, maxResults: 250 });
    return (r.items || [])
      .filter(function (ev) { return ev.start.date && !/observ|conmemora|no laborable/i.test((ev.description || '') + ' ' + (ev.summary || '')); })
      .map(function (ev) { return ev.start.date; });
  } catch (err) {
    return [];
  }
}

// ¿Cada horario cae entero dentro de un bloque disponible, fuera de feriados y sin choques?
// sesiones: [{inicio, fin}]. sinId: ignora los eventos de esa misma reserva (para moverla).
function libres(sesiones, sinId) {
  var min = Math.min.apply(null, sesiones.map(function (x) { return Number(x.inicio); }));
  var max = Math.max.apply(null, sesiones.map(function (x) { return Number(x.fin); }));
  var a = ocupado({ desde: min - 86400000, hasta: max + 86400000, sinId: sinId });
  return sesiones.every(function (x) {
    var ini = Number(x.inicio), fin = Number(x.fin);
    if (a.feriados.indexOf(Utilities.formatDate(new Date(ini), TZ, 'yyyy-MM-dd')) >= 0) return false;
    if (!a.disponibles.some(function (d) { return ini >= d.s && fin <= d.e; })) return false;
    return !a.ocupados.some(function (o) { return ini < o.e && fin > o.s; });
  });
}

// Todos los eventos de una reserva (1 en el Diagnóstico, 8 en un nivel), ordenados por fecha.
function buscarTodos(id) {
  var r = Calendar.Events.list('primary', { privateExtendedProperty: 'apv_id=' + id, showDeleted: false, singleEvents: true, maxResults: 50 });
  return (r.items || []).filter(function (ev) { return ev.status !== 'cancelled'; })
    .sort(function (x, y) { return new Date(x.start.dateTime) - new Date(y.start.dateTime); });
}

function esPack(r) { return Number(r.cantidad || 1) > 1; }

function tituloEvento(r, n) {
  if (!esPack(r)) return r.productoNombre + ' · ' + r.nombre;
  return r.productoNombre + ' · ' + r.nombre + ' · Encuentro ' + n;
}

function retener(b) {
  var sesiones = b.sesiones || [{ inicio: b.inicio, fin: b.fin }];
  var r = b.reserva;
  r.cantidad = sesiones.length;
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (!libres(sesiones)) return { ok: false };
    sesiones.forEach(function (x, i) {
      Calendar.Events.insert({
        summary: '⏳ Pendiente de pago · ' + tituloEvento(r, i + 1),
        description: detalleInterno(r, b) + '\n\nSe libera sola si no se paga antes del ' + fechaLarga(new Date(Number(b.expira))) + '.',
        start: { dateTime: new Date(Number(x.inicio)).toISOString(), timeZone: TZ },
        end: { dateTime: new Date(Number(x.fin)).toISOString(), timeZone: TZ },
        colorId: COLOR_CLASES,
        reminders: { useDefault: false, overrides: [] },
        extendedProperties: { private: {
          apv_id: b.id, apv_n: String(i + 1), apv_estado: 'pendiente', apv_expira: String(b.expira),
          apv_reserva: JSON.stringify(r).slice(0, 1000), apv_ver: b.verUrl || '',
        } },
      }, 'primary');
    });
  } finally {
    lock.releaseLock();
  }
  var c = b.cfg || {};
  var transferencia = null;
  if (r.medio === 'transferencia') {
    transferencia = { alias: c.alias, cbu: c.cbu, cbuEtiqueta: c.cbuEtiqueta || 'CBU', titular: c.titular, monto: r.ahora, vence: Number(b.expira) };
    var fechas = sesiones.map(function (x) { return new Date(Number(x.inicio)); });
    mailMusicoTransferencia(r, b, c, fechas);
    mailAvisoTransferencia(r, b, c, fechas);
  }
  return { ok: true, transferencia: transferencia };
}

function confirmar(b) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var evs = buscarTodos(b.id);
    if (!evs.length) {
      // Pago aprobado de un turno que ya se liberó: no se agenda solo, se avisa para resolverlo a mano.
      if (b.pago && b.pago.mpId) enviar((b.cfg || {}).avisos, 'Revisar: pago de una reserva vencida',
        '<p>Mercado Pago aprobó el pago ' + b.pago.mpId + ' (' + pesos(b.pago.monto || 0) + ') de la reserva ' + b.id +
        ', pero el turno ya se había liberado. Coordiná un horario nuevo con el músico o devolvé el pago.</p>');
      return { estado: 'vencida' };
    }
    var p0 = evs[0].extendedProperties.private;
    var r = JSON.parse(p0.apv_reserva);
    if (p0.apv_estado === 'confirmada') return { estado: 'confirmada', yaEstaba: true, nombre: r.nombre };
    var c = b.cfg || {};
    var pago = b.pago || {};
    if (c.zoom) PropertiesService.getScriptProperties().setProperty('ZOOM', c.zoom);
    evs.forEach(function (ev, i) {
      var p = ev.extendedProperties.private;
      p.apv_estado = 'confirmada';
      p.apv_pago = JSON.stringify(pago).slice(0, 500);
      var n = Number(p.apv_n || i + 1);
      Calendar.Events.patch({
        summary: tituloEvento(r, n),
        location: c.zoom || '',
        description: (esPack(r) ? 'Encuentro ' + n + ' de ' + r.cantidad + ' · ' : '') + 'Zoom: ' + (c.zoom || '(falta el link)') +
          '\n\n' + detalleInterno(r, b) + '\nPago: ' + textoPago(r, pago),
        attendees: [{ email: r.email, displayName: r.nombre }],
        reminders: { useDefault: true },
        extendedProperties: { private: p },
      }, 'primary', ev.id, { sendUpdates: esPack(r) ? 'none' : 'all' });
    });
    var fechas = evs.map(function (ev) { return new Date(ev.start.dateTime); });
    if (r.creditoUsado) usarCredito(r.email);
    if (r.producto === 'diagnostico') guardarCredito(r.email, pago.monto || r.ahora);
    var fila = cargarVenta(r, pago, c, b.id);
    mailMusicoConfirmada(r, fechas, c, p0.apv_ver);
    mailMuse(r, fechas, pago, c, fila);
    return { estado: 'confirmada', nombre: r.nombre };
  } finally {
    lock.releaseLock();
  }
}

function estado(b) {
  var evs = buscarTodos(b.id);
  if (!evs.length) return { estado: 'vencida' };
  var p = evs[0].extendedProperties.private, r = JSON.parse(p.apv_reserva);
  var mov = Number(p.apv_mov || 0), ahora = Date.now();
  var sesiones = evs.map(function (ev, i) {
    var ini = new Date(ev.start.dateTime).getTime();
    return { n: Number(ev.extendedProperties.private.apv_n || i + 1), inicio: ini, cuando: fechaLarga(new Date(ini)), movible: ini - ahora >= 86400000 };
  });
  return {
    estado: p.apv_estado, producto: r.productoNombre, productoClave: r.producto, nombre: r.nombre, medio: r.medio,
    movimientos: mov, maxMovimientos: MAX_MOVIMIENTOS,
    puedeMover: p.apv_estado === 'confirmada' && mov < MAX_MOVIMIENTOS && sesiones.some(function (x) { return x.movible; }),
    inicio: sesiones[0].inicio, cuando: sesiones[0].cuando, sesiones: sesiones,
    ahora: r.ahora, saldo: r.saldo,
  };
}

function liberar(b) {
  buscarTodos(b.id).forEach(function (ev) {
    if (ev.extendedProperties.private.apv_estado === 'pendiente') Calendar.Events.remove('primary', ev.id);
  });
  return { ok: true };
}

// El músico mueve un encuentro: con 24 h de aviso y hasta 2 cambios por reserva (en un nivel, por nivel).
function mover(b) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var evs = buscarTodos(b.id);
    if (!evs.length) return { ok: false, motivo: 'No encuentro la reserva.' };
    var n = Number(b.n || 1);
    var ev = evs.filter(function (x, i) { return Number(x.extendedProperties.private.apv_n || i + 1) === n; })[0];
    if (!ev) return { ok: false, motivo: 'No encuentro ese encuentro.' };
    var p = ev.extendedProperties.private, r = JSON.parse(p.apv_reserva);
    var mov = Number(evs[0].extendedProperties.private.apv_mov || 0), antes = new Date(ev.start.dateTime);
    if (p.apv_estado !== 'confirmada') return { ok: false, motivo: 'La reserva todavía no está confirmada.' };
    if (antes.getTime() - Date.now() < 86400000) return { ok: false, motivo: 'Falta menos de 24 h: para moverlo, escribime por WhatsApp.' };
    if (mov >= MAX_MOVIMIENTOS) return { ok: false, motivo: 'Ya hiciste los ' + MAX_MOVIMIENTOS + ' cambios: escribime por WhatsApp y lo vemos.' };
    var ini = Number(b.inicio), fin = Number(b.fin);
    if (!libres([{ inicio: ini, fin: fin }], b.id)) return { ok: false, motivo: 'Ese horario se acaba de ocupar. Elegí otro.' };
    if (evs.some(function (x) { return x.id !== ev.id && ini < new Date(x.end.dateTime).getTime() && fin > new Date(x.start.dateTime).getTime(); })) {
      return { ok: false, motivo: 'Ese horario choca con otro de tus encuentros. Elegí otro.' };
    }
    evs.forEach(function (x) {
      var px = x.extendedProperties.private;
      px.apv_mov = String(mov + 1);
      var cambio = { extendedProperties: { private: px } };
      if (x.id === ev.id) {
        px.apv_recordado = '';
        cambio.start = { dateTime: new Date(ini).toISOString(), timeZone: TZ };
        cambio.end = { dateTime: new Date(fin).toISOString(), timeZone: TZ };
      }
      Calendar.Events.patch(cambio, 'primary', x.id, { sendUpdates: x.id === ev.id ? 'all' : 'none' });
    });
    var c = b.cfg || {};
    var cual = esPack(r) ? 'tu encuentro ' + n + ' de ' + r.productoNombre : 'tu ' + r.productoNombre;
    enviar(r.email, 'Movido: ' + cual + ' pasa al ' + fechaLarga(new Date(ini)),
      '<p>Hola, ' + primerNombre(r) + '.</p><p>Listo: ' + cual + ' pasó del ' + fechaLarga(antes) + ' al <b>' + fechaLarga(new Date(ini)) +
      '</b> (hora de Argentina). El link de Zoom es el mismo: <a href="' + c.zoom + '">' + c.zoom + '</a>.</p>' +
      '<p>Te quedan ' + (MAX_MOVIMIENTOS - mov - 1) + ' cambios.</p>');
    enviar(c.avisos, 'Reserva movida · ' + r.productoNombre + ' · ' + r.nombre,
      '<p>' + r.nombre + ' movió ' + (esPack(r) ? 'el encuentro ' + n + ' de su ' + r.productoNombre : 'su ' + r.productoNombre) +
      ' del ' + fechaLarga(antes) + ' al ' + fechaLarga(new Date(ini)) + ' (cambio ' + (mov + 1) + ' de ' + MAX_MOVIMIENTOS + ').</p>');
    return { ok: true, cuando: fechaLarga(new Date(ini)) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Créditos ----------
// El Diagnóstico se descuenta del nivel si el músico lo contrata dentro de los 30 días (05 · Precios y reglas).
function claveCredito(email) { return 'credito:' + String(email || '').trim().toLowerCase(); }
function guardarCredito(email, monto) {
  PropertiesService.getScriptProperties().setProperty(claveCredito(email),
    JSON.stringify({ monto: Math.round(monto), vence: Date.now() + 30 * 86400000, origen: 'Diagnóstico' }));
}
function credito(b) {
  var v = PropertiesService.getScriptProperties().getProperty(claveCredito(b.email));
  if (!v) return { monto: 0 };
  var x = JSON.parse(v);
  if (x.usado || x.vence < Date.now()) return { monto: 0 };
  return { monto: x.monto, vence: x.vence, origen: x.origen };
}
function usarCredito(email) {
  var props = PropertiesService.getScriptProperties(), k = claveCredito(email), v = props.getProperty(k);
  if (!v) return;
  var x = JSON.parse(v); x.usado = Date.now(); props.setProperty(k, JSON.stringify(x));
}

// Cada hora: recordatorio al músico 24 h antes de cada encuentro.
function recordatorios() {
  var ahora = Date.now();
  var r = Calendar.Events.list('primary', {
    privateExtendedProperty: 'apv_estado=confirmada', timeMin: new Date(ahora + 22 * 3600000).toISOString(),
    timeMax: new Date(ahora + 25 * 3600000).toISOString(), singleEvents: true, maxResults: 50,
  });
  var zoom = PropertiesService.getScriptProperties().getProperty('ZOOM') || '';
  (r.items || []).forEach(function (ev) {
    var p = ev.extendedProperties.private;
    if (p.apv_recordado) return;
    var res = JSON.parse(p.apv_reserva), ini = new Date(ev.start.dateTime);
    var que = esPack(res) ? 'tu encuentro ' + p.apv_n + ' de ' + res.cantidad + ' (' + res.productoNombre + ')' : 'tu ' + res.productoNombre;
    enviar(res.email, 'Mañana: ' + que,
      '<p>Hola, ' + primerNombre(res) + '.</p><p>Te recuerdo ' + que + ': <b>' + fechaLarga(ini) + '</b> (hora de Argentina).</p>' +
      '<p>Link de Zoom: <a href="' + (ev.location || zoom) + '">' + (ev.location || zoom) + '</a></p>' +
      (res.saldo > 0 ? '<p>Acordate de transferir el saldo de ' + pesos(res.saldo) + ' antes del encuentro.</p>' : '') + '<p>Nos vemos.</p>');
    p.apv_recordado = '1';
    Calendar.Events.patch({ extendedProperties: { private: p } }, 'primary', ev.id);
  });
}

// La venta va sola a 02 · Métricas › Ventas: primera fila vacía, columnas A a H (I es fórmula).
// Monto = el neto (lo que acredita Mercado Pago o lo transferido), como pide la regla de Ventas.
var PRODUCTO_VENTAS = {
  'diagnostico': 'Diagnóstico', 'encuentro-a-medida': 'Encuentro suelto',
  'nivel-1': 'A · Nivel 1', 'nivel-2': 'A · Nivel 2', 'nivel-3': 'A · Nivel 3',
  'kit-express': 'Kit P · Express', 'kit-calma': 'Kit P · Calma', 'kit-puente': 'Kit P · Puente',
};
function cargarVenta(r, pago, c, id) {
  if (!c.ventas) return null;
  try {
    var hoja = SpreadsheetApp.openById(c.ventas).getSheetByName('Métricas · Ventas');
    var col = hoja.getRange('A5:A404').getValues();
    var i = 0;
    while (i < col.length && col[i][0] !== '') i++;
    if (i >= col.length) return null;
    var origen = r.origen === 'Ya trabajé con Fede' ? 'Músico pasado' : (r.origen || '');
    var monto = pago.neto || pago.monto || r.ahora;
    var notas = 'Reserva web (T43), código ' + id + ' · medio: ' + (pago.medio || r.medio) + (pago.mpId ? ', op. MP ' + pago.mpId : '') +
      (r.creditoUsado ? ' · crédito del Diagnóstico aplicado: ' + pesos(r.creditoUsado) : '') +
      (r.saldo > 0 ? ' · seña; saldo ' + pesos(r.saldo) + ' (se carga aparte al cobrarlo)' : '') +
      (r.origen === 'Ya trabajé con Fede' ? ' · origen: «ya trabajé con Fede» (revisar si es activo o pasado)' : '') +
      (r.origen ? '' : ' · origen: no lo marcó en la reserva');
    hoja.getRange(i + 5, 1, 1, 8).setValues([[new Date(), r.nombre, PRODUCTO_VENTAS[r.producto] || r.productoNombre, origen, 'Contado', Math.round(monto), 'Web', notas]]);
    hoja.getRange(i + 5, 1).setNumberFormat('dd/MM/yyyy');
    return i + 5;
  } catch (err) {
    return null;
  }
}

// Cada 10 minutos: libera los turnos retenidos que no se pagaron a tiempo.
function limpiar() {
  var ahora = Date.now();
  var r = Calendar.Events.list('primary', {
    privateExtendedProperty: 'apv_estado=pendiente', timeMin: new Date(ahora - 86400000).toISOString(),
    singleEvents: true, maxResults: 250,
  });
  (r.items || []).forEach(function (ev) {
    if (Number(ev.extendedProperties.private.apv_expira) < ahora) Calendar.Events.remove('primary', ev.id);
  });
}

// ---------- Textos ----------
function pesos(n) { return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function fechaLarga(d) {
  var dia = Number(Utilities.formatDate(d, TZ, 'u')) % 7; // 1 = lunes … 7 = domingo
  return DIAS[dia] + ' ' + Utilities.formatDate(d, TZ, 'd') + ' de ' + MESES[Number(Utilities.formatDate(d, TZ, 'M')) - 1] + ' a las ' + Utilities.formatDate(d, TZ, 'H:mm');
}
function diaCorto(d) {
  var dia = Number(Utilities.formatDate(d, TZ, 'u')) % 7;
  return DIAS[dia] + ' ' + Utilities.formatDate(d, TZ, 'd') + ' de ' + MESES[Number(Utilities.formatDate(d, TZ, 'M')) - 1];
}
function listaFechas(fechas) {
  return '<ol style="padding-left:22px;margin:8px 0">' + fechas.map(function (f) { return '<li>' + fechaLarga(f) + '</li>'; }).join('') + '</ol>';
}
function textoPago(r, pago) {
  var t = pago.medio === 'transferencia' ? 'transferencia' : 'tarjeta (Mercado Pago' + (pago.mpId ? ', op. ' + pago.mpId : '') + ')';
  t += ' · ' + pesos(r.ahora);
  if (r.creditoUsado) t += ' (con crédito del Diagnóstico de ' + pesos(r.creditoUsado) + ')';
  if (r.saldo > 0) t += ' de seña; saldo ' + pesos(r.saldo);
  return t;
}
function detalleInterno(r, b) {
  return [
    'Reserva web (leeraprimeravista.com) · ' + r.productoNombre,
    'Músico: ' + r.nombre,
    'Mail: ' + r.email,
    'WhatsApp: ' + r.whatsapp,
    r.nota ? 'Nota del músico: ' + r.nota : '',
    'Código: ' + b.id,
  ].filter(String).join('\n');
}
function envolver(cuerpo) {
  return '<div style="font-family:Georgia,serif;font-size:17px;line-height:1.6;color:#052E5E;max-width:560px">' + cuerpo +
    '<p style="margin-top:28px">Fede<br><span style="color:#3D5576">A Primera Vista · leeraprimeravista.com</span></p></div>';
}
function enviar(para, asunto, html, adjuntos) {
  if (!para) return;
  var m = { to: para, subject: asunto, htmlBody: envolver(html), name: 'Fede · A Primera Vista' };
  if (adjuntos) m.attachments = adjuntos;
  MailApp.sendEmail(m);
}
function primerNombre(r) { return String(r.nombre).split(' ')[0]; }

// Archivo .ics con todos los encuentros, para sumarlos al calendario de una vez.
function archivoCalendario(r, fechas, c, duracionMin) {
  var f = function (d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); };
  var lineas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//A Primera Vista//Reservas//ES', 'METHOD:PUBLISH'];
  fechas.forEach(function (d, i) {
    var fin = new Date(d.getTime() + duracionMin * 60000);
    lineas.push('BEGIN:VEVENT', 'UID:apv-' + f(d) + '-' + i + '@leeraprimeravista.com', 'DTSTAMP:' + f(new Date()),
      'DTSTART:' + f(d), 'DTEND:' + f(fin),
      'SUMMARY:' + r.productoNombre + (fechas.length > 1 ? ' · Encuentro ' + (i + 1) : '') + ' · A Primera Vista',
      'LOCATION:' + (c.zoom || ''), 'DESCRIPTION:Por Zoom: ' + (c.zoom || ''), 'END:VEVENT');
  });
  lineas.push('END:VCALENDAR');
  return Utilities.newBlob(lineas.join('\r\n'), 'text/calendar', 'encuentros-a-primera-vista.ics');
}

function mailMusicoTransferencia(r, b, c, fechas) {
  var cuando = fechas.length > 1 ? 'tus ' + fechas.length + ' encuentros:' + listaFechas(fechas) : 'el turno del <b>' + fechaLarga(fechas[0]) + '</b> para tu ' + r.productoNombre + '.';
  enviar(r.email, 'Tu ' + r.productoNombre + ': datos para la transferencia',
    '<p>Hola, ' + primerNombre(r) + '.</p>' +
    '<p>Te guardé ' + cuando + '</p>' +
    '<p>Para confirmarlo, transferí <b>' + pesos(r.ahora) + '</b>' + (r.saldo > 0 ? ' (la seña)' : '') + ' a:</p>' +
    '<p>Alias: <b>' + (c.alias || '') + '</b><br>' + (c.cbu ? (c.cbuEtiqueta || 'CBU') + ': ' + c.cbu + '<br>' : '') + (c.titular ? 'Titular: ' + c.titular : '') + '</p>' +
    '<p>Y mandame el comprobante por WhatsApp. ' + (fechas.length > 1 ? 'Los turnos quedan guardados' : 'El turno queda guardado') + ' hasta el ' + fechaLarga(new Date(Number(b.expira))) + '.</p>');
}
function mailAvisoTransferencia(r, b, c, fechas) {
  enviar(c.avisos, 'Reserva por transferencia · ' + r.productoNombre + ' · ' + r.nombre,
    '<p>' + r.nombre + ' reservó ' + r.productoNombre + (fechas.length > 1 ? ' desde el ' + fechaLarga(fechas[0]) + ' (' + fechas.length + ' encuentros)' : ' para el ' + fechaLarga(fechas[0])) +
    ' y va a transferir ' + pesos(r.ahora) + '.</p>' +
    '<p>WhatsApp: ' + r.whatsapp + '</p>' +
    '<p>Cuando veas el comprobante, tocá acá: <a href="' + b.confirmarUrl + '">confirmar la reserva</a>. Si no llega, se libera sola el ' + fechaLarga(new Date(Number(b.expira))) + '.</p>');
}
function mailMusicoConfirmada(r, fechas, c, verUrl) {
  var saldo = r.saldo > 0 ? '<p>Quedó paga la seña. El saldo de <b>' + pesos(r.saldo) + '</b> se abona antes del encuentro, por transferencia.</p>' : '';
  var extra = {
    'diagnostico': '<p>No hace falta que prepares nada.</p>',
    'encuentro-a-medida': '<p>Respondé este mail con la partitura o el material sobre el que querés trabajar, así lo preparo antes.</p>',
  }[r.producto] || '';
  var garantia = /^nivel-/.test(r.producto) ? '<p>La garantía del nivel: «Si al llegar al octavo encuentro todavía no alcanzaste los hitos del nivel, seguimos sin cargo hasta completarlos.»</p>' : '';
  var moverUrl = verUrl + '&mover=1';
  if (fechas.length > 1) {
    enviar(r.email, 'Confirmado: tu ' + r.productoNombre + ' arranca el ' + diaCorto(fechas[0]),
      '<p>Hola, ' + primerNombre(r) + '.</p>' +
      '<p>Quedó confirmado tu <b>' + r.productoNombre + '</b>. Tus ' + fechas.length + ' encuentros, por Zoom (hora de Argentina):</p>' + listaFechas(fechas) +
      '<p>El link de Zoom es el mismo para todos: <a href="' + c.zoom + '">' + c.zoom + '</a><br>Te adjunto un archivo para sumarlos a tu calendario de una vez.</p>' +
      garantia +
      '<p>Si necesitás mover alguno, lo hacés vos desde <a href="' + moverUrl + '">este link</a>, con 24 h de aviso (hasta ' + MAX_MOVIMIENTOS + ' cambios). Cualquier otra cosa, escribime por WhatsApp: <a href="https://wa.me/' + c.whatsapp + '">wa.me/' + c.whatsapp + '</a>.</p>',
      [archivoCalendario(r, fechas, c, r.duracion || 60)]);
    return;
  }
  enviar(r.email, 'Confirmado: tu ' + r.productoNombre + ' del ' + fechaLarga(fechas[0]),
    '<p>Hola, ' + primerNombre(r) + '.</p>' +
    '<p>Quedó confirmado tu <b>' + r.productoNombre + '</b>. Nos vemos el <b>' + fechaLarga(fechas[0]) + '</b> (hora de Argentina), por Zoom.</p>' +
    '<p>Link: <a href="' + c.zoom + '">' + c.zoom + '</a><br>También te llegó la invitación al calendario.</p>' + extra + saldo +
    '<p>Si necesitás mover el horario, lo hacés vos desde <a href="' + moverUrl + '">este link</a>, con 24 h de aviso. Cualquier otra cosa, escribime por WhatsApp: <a href="https://wa.me/' + c.whatsapp + '">wa.me/' + c.whatsapp + '</a>.</p>');
}
// A Muse le llega el aviso de la venta, ya cargada en Ventas, para que sume la ficha del músico.
function mailMuse(r, fechas, pago, c, fila) {
  var para = [c.muse, c.avisos].filter(String).join(',');
  var bienvenida = /^nivel-|^kit-/.test(r.producto) ? '<p>Es un recorrido nuevo: seguí el onboarding de siempre (kit de bienvenida y videos), igual que con las reservas de Agora.</p>' : '';
  enviar(para, 'Venta web · ' + r.productoNombre + ' · ' + r.nombre,
    '<p>Venta nueva desde leeraprimeravista.com (T43). ' + (fila
      ? 'Ya quedó cargada en 02 · Métricas › Ventas, fila ' + fila + ' (Cargó = Web). Muse: no la cargues de nuevo; sumá o actualizá la ficha del músico y revisá el Origen.'
      : 'No se pudo cargar sola en 02 · Métricas › Ventas: Muse, cargala vos con estos datos.') + '</p>' + bienvenida +
    '<p>Músico: ' + r.nombre + '<br>Producto: ' + r.productoNombre + '<br>' +
    'Pago: Contado · ' + textoPago(r, pago) + (pago.neto ? ' (neto acreditado por MP: ' + pesos(pago.neto) + ')' : '') + '<br>' +
    (fechas.length > 1 ? 'Encuentros: ' + fechas.map(function (f) { return fechaLarga(f); }).join(' · ') : 'Encuentro: ' + fechaLarga(fechas[0])) +
    '<br>Mail: ' + r.email + '<br>WhatsApp: ' + r.whatsapp +
    '<br>¿Cómo te enteraste?: ' + (r.origen || '(no lo marcó)') + (r.nota ? '<br>Nota del músico: ' + r.nota : '') + '</p>');
}
