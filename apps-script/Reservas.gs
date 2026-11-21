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

// El calendario donde Fede marca cuándo atiende. Se crea una vez con un bloque de lunes a viernes
// de 9 a 16 que se repite cada semana (decisión de Fede, 21/11/2026): lo que ya está en sus otros
// calendarios se bloquea solo, y para cambiar una semana se mueve, acorta o borra ese bloque.
function calendarioDisponibilidad() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CAL_DISP');
  var cal = id && CalendarApp.getCalendarById(id);
  if (cal) return cal;
  cal = CalendarApp.createCalendar(CAL_DISPONIBILIDAD, { color: CalendarApp.Color.YELLOW, timeZone: TZ });
  props.setProperty('CAL_DISP', cal.getId());
  var hoy = new Date(), lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - ((hoy.getDay() + 6) % 7) + 7);
  var ini = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate(), 9), fin = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate(), 16);
  cal.createEventSeries('Disponible', ini, fin, CalendarApp.newRecurrence().addWeeklyRule()
    .onlyOnWeekdays([CalendarApp.Weekday.MONDAY, CalendarApp.Weekday.TUESDAY, CalendarApp.Weekday.WEDNESDAY, CalendarApp.Weekday.THURSDAY, CalendarApp.Weekday.FRIDAY]));
  return cal;
}

// ---------- Entrada ----------
var CFG_ACTUAL = null; // la configuración que mandó Vercel en este pedido
function doPost(e) {
  var salida;
  try {
    var b = JSON.parse(e.postData.contents);
    // Primero la clave: sin ella no se lee ni se guarda nada de lo que llega.
    if (!b.secret || b.secret !== PropertiesService.getScriptProperties().getProperty('SECRET')) throw new Error('clave inválida');
    CFG_ACTUAL = b.cfg || null;
    // Las tareas automáticas (limpiar, recordatorios) no reciben la configuración: queda guardada la última.
    if (b.cfg) PropertiesService.getScriptProperties().setProperty('CFG', JSON.stringify({ muse: b.cfg.muse, avisos: b.cfg.avisos, ventas: b.cfg.ventas, sitio: b.cfg.sitio, whatsapp: b.cfg.whatsapp }));
    var acciones = { ocupado: ocupado, retener: retener, confirmar: confirmar, estado: estado, liberar: liberar, mover: mover, credito: credito,
      habilitado: habilitado, pedirAcceso: pedirAcceso, habilitar: habilitar, evento: evento };
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
  var ocupados = [], disponibles = [], sueltos = [];
  var dispId = PropertiesService.getScriptProperties().getProperty('CAL_DISP');
  // Todos los calendarios en los que Fede es dueño o puede editar (el personal, Familia, el de RE/MAX…).
  // Quedan afuera los que solo lee (feriados, calendarios importados de terceros).
  calendariosPropios().forEach(function (cal) {
    var token, esDisp = cal.getId() === dispId;
    do {
      var r = Calendar.Events.list(cal.getId(), {
        timeMin: desde.toISOString(), timeMax: hasta.toISOString(),
        singleEvents: true, maxResults: 2500, pageToken: token,
      });
      (r.items || []).forEach(function (ev) {
        if (ev.status === 'cancelled') return;
        if (esDisp) {
          if (ev.start.dateTime) {
            disponibles.push({ s: new Date(ev.start.dateTime).getTime(), e: new Date(ev.end.dateTime).getTime() });
            if (!ev.recurringEventId) sueltos.push(Utilities.formatDate(new Date(ev.start.dateTime), TZ, 'yyyy-MM-dd'));
          }
          return;
        }
        if (b.sinId && ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.apv_id === b.sinId) return;
        if (ev.transparency === 'transparent') return;
        var yo = (ev.attendees || []).filter(function (a) { return a.self; })[0];
        if (yo && yo.responseStatus === 'declined') return;
        // Los eventos de día completo (cumpleaños, recordatorios) no bloquean: los días libres
        // y las vacaciones se manejan sacando el «Disponible» de APV · Disponibilidad.
        if (!ev.start.dateTime) return;
        var s = new Date(ev.start.dateTime).getTime(), f = new Date(ev.end.dateTime).getTime();
        if (ev.location && !/zoom|meet\.google|https?:|virtual|online/i.test(ev.location)) {
          s -= MARGEN_TRASLADO_MIN * 60000; f += MARGEN_TRASLADO_MIN * 60000;
        }
        ocupados.push({ s: s, e: f });
      });
      token = r.nextPageToken;
    } while (token);
  });
  return { disponibles: disponibles, ocupados: ocupados, feriados: feriados(desde, hasta, b.cfg, sueltos) };
}

function calendariosPropios() {
  var lista = [], token;
  do {
    var r = Calendar.CalendarList.list({ pageToken: token, maxResults: 250 });
    (r.items || []).forEach(function (c) {
      if ((c.accessRole === 'owner' || c.accessRole === 'writer') && c.id !== FERIADOS_CAL) lista.push({ getId: function () { return c.id; } });
    });
    token = r.nextPageToken;
  } while (token);
  return lista;
}

// Días sin encuentros: los feriados del calendario de Google (sin las celebraciones que no son feriado,
// como Fin de Año o las fechas religiosas provisionales) más los de la pestaña «Feriados» de
// 08 · Calendarios del Kit de Audición, donde Fede también anota sus vacaciones.
// Si Fede quiere trabajar un feriado, crea ese día un evento «Disponible» suelto (no repetido) en
// «APV · Disponibilidad»: ese día deja de contar como feriado.
var NO_FERIADO = /provisional|fin de año|nochebuena|pascua|ramad|ayuno|rosh|kipur|januc|día de la madre|día del padre|día del niño/i;
function feriados(desde, hasta, cfg, sueltos) {
  var dias = {};
  try {
    var r = Calendar.Events.list(FERIADOS_CAL, { timeMin: desde.toISOString(), timeMax: hasta.toISOString(), singleEvents: true, maxResults: 250 });
    (r.items || []).forEach(function (ev) {
      if (ev.start.date && !NO_FERIADO.test(ev.summary || '')) dias[ev.start.date] = true;
    });
  } catch (err) {}
  if (cfg && cfg.feriadosSheet) {
    try {
      var hoja = SpreadsheetApp.openById(cfg.feriadosSheet).getSheetByName('Feriados');
      hoja.getRange('A2:A200').getValues().forEach(function (fila) {
        var v = fila[0], d = null;
        if (v instanceof Date) d = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
        else { var m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v)); if (m) d = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
        if (d) dias[d] = true;
      });
    } catch (err) {}
  }
  (sueltos || []).forEach(function (d) { delete dias[d]; });
  return Object.keys(dias);
}

// ¿Cada horario cae entero dentro de un bloque disponible, fuera de feriados y sin choques?
// sesiones: [{inicio, fin}]. sinId: ignora los eventos de esa misma reserva (para moverla).
function libres(sesiones, sinId, cfg) {
  var min = Math.min.apply(null, sesiones.map(function (x) { return Number(x.inicio); }));
  var max = Math.max.apply(null, sesiones.map(function (x) { return Number(x.fin); }));
  var a = ocupado({ desde: min - 86400000, hasta: max + 86400000, sinId: sinId, cfg: cfg || CFG_ACTUAL });
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

// Cada sesión de una reserva: {inicio, fin, tipo ('encuentro' | 'simulacro'), n}.
function etiqueta(x) { return (x.tipo === 'simulacro' ? 'Simulacro ' : 'Encuentro ') + x.n; }
function tituloEvento(r, x) {
  if (!esPack(r)) return r.productoNombre + ' · ' + r.nombre;
  return r.productoNombre + ' · ' + r.nombre + ' · ' + etiqueta(x);
}
function maxMov(r) { return r.maxMov != null ? Number(r.maxMov) : MAX_MOVIMIENTOS; }
// Normaliza las sesiones que llegan de Vercel (los niveles viejos no traen tipo ni n).
function normalizar(sesiones) {
  var cuenta = { encuentro: 0, simulacro: 0 };
  return sesiones.map(function (x) {
    var tipo = x.tipo || 'encuentro';
    cuenta[tipo]++;
    return { inicio: Number(x.inicio), fin: Number(x.fin), tipo: tipo, n: x.n || cuenta[tipo] };
  });
}
function sesionDeEvento(ev, i) {
  var p = ev.extendedProperties.private;
  return { inicio: new Date(ev.start.dateTime).getTime(), fin: new Date(ev.end.dateTime).getTime(), tipo: p.apv_tipo || 'encuentro', n: Number(p.apv_n || i + 1) };
}

function retener(b) {
  var sesiones = normalizar(b.sesiones || [{ inicio: b.inicio, fin: b.fin }]);
  var r = b.reserva;
  r.cantidad = sesiones.length;
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (!libres(sesiones)) return { ok: false };
    sesiones.forEach(function (x, i) {
      Calendar.Events.insert({
        summary: '⏳ Pendiente de pago · ' + tituloEvento(r, x),
        description: detalleInterno(r, b) + '\n\nSe libera sola si no se paga antes del ' + fechaLarga(new Date(Number(b.expira))) + '.',
        start: { dateTime: new Date(Number(x.inicio)).toISOString(), timeZone: TZ },
        end: { dateTime: new Date(Number(x.fin)).toISOString(), timeZone: TZ },
        colorId: COLOR_CLASES,
        reminders: { useDefault: false, overrides: [] },
        extendedProperties: { private: {
          apv_id: b.id, apv_n: String(x.n), apv_tipo: x.tipo, apv_estado: 'pendiente', apv_expira: String(b.expira),
          apv_reserva: reservaParaGuardar(r), apv_ver: b.verUrl || '',
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
    mailMusicoTransferencia(r, b, c, sesiones);
    mailAvisoTransferencia(r, b, c, sesiones);
  }
  return { ok: true, transferencia: transferencia };
}

// El calendario guarda hasta ~1.000 caracteres por dato. Si no entra, se acorta la nota del músico
// (completa en la descripción del evento): nunca se corta el JSON, porque después no se podría leer.
function reservaParaGuardar(r) {
  var x = JSON.parse(JSON.stringify(r)), js = JSON.stringify(x);
  if (js.length > 1000 && x.nota) { x.nota = x.nota.slice(0, Math.max(0, x.nota.length - (js.length - 1000) - 3)) + '…'; js = JSON.stringify(x); }
  if (js.length > 1000) { delete x.nota; delete x.origenWeb; delete x.sesion; js = JSON.stringify(x); }
  return js;
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
      var x = sesionDeEvento(ev, i);
      Calendar.Events.patch({
        summary: tituloEvento(r, x),
        location: c.zoom || '',
        description: (esPack(r) ? etiqueta(x) + ' · ' + r.productoNombre + ' · ' : '') + 'Zoom: ' + (c.zoom || '(falta el link)') +
          '\n\n' + detalleInterno(r, b) + '\nPago: ' + textoPago(r, pago),
        attendees: [{ email: r.email, displayName: r.nombre }],
        reminders: { useDefault: true },
        extendedProperties: { private: p },
      }, 'primary', ev.id, { sendUpdates: esPack(r) ? 'none' : 'all' });
    });
    var sesiones = evs.map(sesionDeEvento);
    if (r.creditoUsado) usarCredito(r.email);
    // Los 30 días del crédito corren desde el día del Diagnóstico, no desde el pago (decisión de Fede, 21/11/2026).
    if (r.producto === 'diagnostico') guardarCredito(r.email, pago.monto || r.ahora, Math.max.apply(null, sesiones.map(function (x) { return x.fin; })) + 30 * 86400000 - Date.now(), 'Diagnóstico');
    if (/^kit-/.test(r.producto) && r.audicion) guardarCredito(r.email, 90000, Number(r.audicion) + 60 * 86400000 - Date.now(), 'Kit de Audición');
    var nv = /^nivel-(\d)$/.exec(r.producto);
    if (nv) guardarNivel(r.email, Number(nv[1]), Math.max.apply(null, sesiones.map(function (x) { return x.fin; })));
    var fila = cargarVenta(r, pago, c, b.id);
    registrarEvento(c, r.sesion || '', 'Pagó', r.producto, pago.medio || r.medio, r.origenWeb || '', true);
    mailMusicoConfirmada(r, sesiones, c, p0.apv_ver);
    mailMuse(r, sesiones, pago, c, fila);
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
    var x = sesionDeEvento(ev, i);
    x.etiqueta = etiqueta(x); x.cuando = fechaLarga(new Date(x.inicio)); x.movible = x.inicio - ahora >= 86400000;
    return x;
  });
  return {
    estado: p.apv_estado, producto: r.productoNombre, productoClave: r.producto, nombre: r.nombre, medio: r.medio,
    movimientos: mov, maxMovimientos: maxMov(r), mismaSemana: !!r.mismaSemana,
    puedeMover: p.apv_estado === 'confirmada' && mov < maxMov(r) && sesiones.some(function (x) { return x.movible; }),
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
    var n = Number(b.n || 1), tipo = b.tipo || 'encuentro';
    var ev = evs.filter(function (x, i) { var s = sesionDeEvento(x, i); return s.n === n && s.tipo === tipo; })[0];
    if (!ev) return { ok: false, motivo: 'No encuentro ese encuentro.' };
    var p = ev.extendedProperties.private, r = JSON.parse(p.apv_reserva);
    var mov = Number(evs[0].extendedProperties.private.apv_mov || 0), antes = new Date(ev.start.dateTime);
    if (p.apv_estado !== 'confirmada') return { ok: false, motivo: 'La reserva todavía no está confirmada.' };
    if (antes.getTime() - Date.now() < 86400000) return { ok: false, motivo: 'Falta menos de 24 h: para moverlo, escribime por WhatsApp.' };
    if (mov >= maxMov(r)) return { ok: false, motivo: (maxMov(r) === 1 ? 'Ya hiciste el cambio que incluye' : 'Ya hiciste los ' + maxMov(r) + ' cambios que incluye') + ' tu reserva: escribime por WhatsApp y lo vemos.' };
    var ini = Number(b.inicio);
    var fin = ini + (new Date(ev.end.dateTime).getTime() - antes.getTime());
    if (r.mismaSemana && semanaDe(ini) !== semanaDe(antes.getTime())) return { ok: false, motivo: 'En el Kit, los cambios son dentro de la misma semana. Elegí otro día de esa semana.' };
    if (r.audicion && ini >= Number(r.audicion)) return { ok: false, motivo: 'Ese horario queda después de tu audición. Elegí otro.' };
    // En los niveles, uno por semana: no se juntan dos encuentros en la misma semana.
    if (/^nivel-/.test(r.producto) && evs.some(function (x) { return x.id !== ev.id && semanaDe(new Date(x.start.dateTime).getTime()) === semanaDe(ini); })) {
      return { ok: false, motivo: 'Esa semana ya tenés otro encuentro del nivel. Elegí un día de otra semana.' };
    }
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
    var sx = { tipo: tipo, n: n };
    var cual = esPack(r) ? 'tu ' + etiqueta(sx).toLowerCase() + ' de ' + r.productoNombre : 'tu ' + r.productoNombre;
    enviar(r.email, 'Movido: ' + cual + ' pasa al ' + fechaLarga(new Date(ini)),
      '<p>Hola, ' + primerNombre(r) + '.</p><p>Listo: ' + cual + ' pasó del ' + fechaLarga(antes) + ' al <b>' + fechaLarga(new Date(ini)) +
      '</b> (hora de Argentina). El link de Zoom es el mismo: <a href="' + c.zoom + '">' + c.zoom + '</a>.</p>' +
      (maxMov(r) - mov - 1 > 0 ? '<p>Te queda' + (maxMov(r) - mov - 1 === 1 ? ' 1 cambio' : 'n ' + (maxMov(r) - mov - 1) + ' cambios') + '.</p>' : '<p>Con este, ya usaste los cambios que incluye tu reserva.</p>'));
    enviar(c.avisos, 'Reserva movida · ' + r.productoNombre + ' · ' + r.nombre,
      '<p>' + r.nombre + ' movió ' + (esPack(r) ? 'el ' + etiqueta(sx).toLowerCase() + ' de su ' + r.productoNombre : 'su ' + r.productoNombre) +
      ' del ' + fechaLarga(antes) + ' al ' + fechaLarga(new Date(ini)) + ' (cambio ' + (mov + 1) + ' de ' + maxMov(r) + ').</p>');
    // Si se mueve el Diagnóstico, el crédito vence 30 días después de la fecha nueva.
    if (r.producto === 'diagnostico') moverCredito(r.email, fin + 30 * 86400000);
    return { ok: true, cuando: fechaLarga(new Date(ini)) };
  } finally {
    lock.releaseLock();
  }
}

function semanaDe(ms) { // lunes de esa semana, en hora argentina
  var d = new Date(ms - 3 * 3600000);
  var dow = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
}

// ---------- Créditos ----------
// El Diagnóstico se descuenta del nivel si el músico lo contrata dentro de los 30 días (05 · Precios y reglas).
function claveCredito(email) { return 'credito:' + String(email || '').trim().toLowerCase(); }
function guardarCredito(email, monto, vigenciaMs, origen) {
  var actual = credito({ email: email });
  if (actual.monto > monto) return; // si ya tiene uno mayor vigente, queda ese
  PropertiesService.getScriptProperties().setProperty(claveCredito(email),
    JSON.stringify({ monto: Math.round(monto), vence: Date.now() + vigenciaMs, origen: origen }));
}
function credito(b) {
  var v = PropertiesService.getScriptProperties().getProperty(claveCredito(b.email));
  if (!v) return { monto: 0 };
  var x = JSON.parse(v);
  if (x.usado || x.vence < Date.now()) return { monto: 0 };
  return { monto: x.monto, vence: x.vence, origen: x.origen };
}
function moverCredito(email, vence) {
  var props = PropertiesService.getScriptProperties(), k = claveCredito(email), v = props.getProperty(k);
  if (!v) return;
  var x = JSON.parse(v);
  if (x.usado || x.origen !== 'Diagnóstico') return;
  x.vence = vence; props.setProperty(k, JSON.stringify(x));
}
function usarCredito(email) {
  var props = PropertiesService.getScriptProperties(), k = claveCredito(email), v = props.getProperty(k);
  if (!v) return;
  var x = JSON.parse(v); x.usado = Date.now(); props.setProperty(k, JSON.stringify(x));
}

// ---------- Acceso a los Niveles 2 y 3 ----------
// N2 y N3 se contratan al terminar el anterior (05 · Precios y reglas). Quien hizo el nivel anterior
// por la web queda habilitado solo; a los demás los habilita Fede con un toque desde el mail de pedido.
function claveNivel(email) { return 'nivel:' + String(email || '').trim().toLowerCase(); }
function leerNivel(email) {
  var v = PropertiesService.getScriptProperties().getProperty(claveNivel(email));
  return v ? JSON.parse(v) : { n: 0, fin: 0 };
}
function guardarNivel(email, n, fin) {
  var x = leerNivel(email);
  if (n < x.n) return;
  PropertiesService.getScriptProperties().setProperty(claveNivel(email), JSON.stringify({ n: n, fin: n === x.n ? Math.max(fin || 0, x.fin || 0) : (fin || 0) }));
}
function habilitado(b) {
  var nivel = Number(b.nivel), x = leerNivel(b.email);
  if (x.n >= nivel - 1) return { ok: true, desde: x.n === nivel - 1 ? (x.fin || 0) : 0 };
  if (nivelEnFichas(b.email, b.cfg || CFG_ACTUAL || {}) >= nivel - 1) return { ok: true, desde: 0 };
  return { ok: false };
}
// La base de clientes: 02 › Fichas. Si el mail figura en Navegar la Partitura (Recorrido A), devuelve el último nivel terminado.
function nivelEnFichas(email, c) {
  try {
    var id = c.ventas; if (!id) return 0;
    var hoja = SpreadsheetApp.openById(id).getSheetByName('Fichas'); if (!hoja) return 0;
    var datos = hoja.getDataRange().getValues();
    var fila = -1, cols = {};
    for (var i = 0; i < Math.min(datos.length, 10); i++) {
      if (datos[i].indexOf('Músico') >= 0 && datos[i].indexOf('Mail') >= 0) { fila = i; datos[i].forEach(function (t, j) { cols[t] = j; }); break; }
    }
    if (fila < 0) return 0;
    var mail = String(email || '').trim().toLowerCase(), mejor = 0;
    for (var r = fila + 1; r < datos.length; r++) {
      var d = datos[r];
      var mails = String(d[cols['Mail']] || '').toLowerCase().split(/[\s,;]+/);
      if (mails.indexOf(mail) < 0) continue;
      if (String(d[cols['Recorrido']]).trim() !== 'A') continue;
      // Un nivel cuenta como terminado recién cuando la ficha llega al encuentro 8 (decisión de Fede, 21/11/2026).
      var nivel = Number(d[cols['Nivel']]) || 0;
      var ultimo = cols['Último Nº de encuentro'] != null ? Number(d[cols['Último Nº de encuentro']]) || 0 : 0;
      mejor = Math.max(mejor, ultimo >= 8 ? nivel : nivel - 1);
    }
    return mejor;
  } catch (e) { return 0; }
}

// ---------- Embudo de la página de reservas ----------
// Cada paso queda en 02 › Captación · Reservas web: sin datos personales, solo una sesión anónima.
var PASOS = ['Entró', 'Puso la fecha de audición', 'Vio horarios', 'Eligió horario', 'Revisó acceso', 'Pidió acceso', 'Envió la reserva', 'Error', 'Fue a suscribirse al Club', 'Pagó'];
function evento(b) {
  if (PASOS.indexOf(b.paso) < 0) return { ok: false };
  registrarEvento(b.cfg || {}, b.sesion, b.paso, b.propuesta, b.detalle, b.origen);
  return { ok: true };
}
function registrarEvento(c, sesion, paso, propuesta, detalle, origen, yaConLock) {
  try {
    if (!c.ventas) return;
    var hoja = SpreadsheetApp.openById(c.ventas).getSheetByName('Captación · Reservas web'); if (!hoja) return;
    var corto = function (s, n) { return String(s || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n); };
    var lock = yaConLock ? null : LockService.getScriptLock(); if (lock && !lock.tryLock(8000)) return;
    // La tabla de datos va en A:F desde la fila 5 (a la derecha está el resumen): primera fila libre de la columna A.
    var fila = hoja.getRange('A5').isBlank() ? 5 : hoja.getRange('A4').getNextDataCell(SpreadsheetApp.Direction.DOWN).getRow() + 1;
    if (fila > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 1000);
    hoja.getRange(fila, 1, 1, 6).setValues([[new Date(), corto(sesion, 24), paso, corto(propuesta, 40), corto(detalle, 120), corto(origen, 60)]]);
    SpreadsheetApp.flush(); if (lock) lock.releaseLock();
  } catch (e) { /* el embudo nunca frena una reserva */ }
}
function pedirAcceso(b) {
  var c = b.cfg || {}, nivel = Number(b.nivel);
  if (habilitado(b).ok) return { ok: true, yaEsta: true };
  enviar(c.avisos, 'Pedido de acceso al Nivel ' + nivel + ' · ' + b.nombre,
    '<p>' + b.nombre + ' (' + b.email + ') quiere reservar el Nivel ' + nivel + ' de Navegar la Partitura y la web no encuentra su Nivel ' + (nivel - 1) +
    ' (seguramente lo hizo antes de que existiera la página de reservas).</p><p>Si corresponde, tocá acá y le llega un mail para reservar: <a href="' + b.habilitarUrl + '">habilitar el Nivel ' + nivel + '</a>.</p>' +
    '<p>Si no corresponde, no hagas nada.</p>');
  return { ok: true };
}
function habilitar(b) {
  var nivel = Number(b.nivel);
  var ya = habilitado(b).ok;
  if (!ya) guardarNivel(b.email, nivel - 1, 0);
  enviar(b.email, 'Ya podés reservar el Nivel ' + nivel,
    '<p>Hola' + (b.nombre ? ', ' + String(b.nombre).split(' ')[0] : '') + '.</p><p>Listo: ya podés reservar el Nivel ' + nivel +
    ' de Navegar la Partitura. Entrá acá y usá este mismo mail: <a href="' + b.reservarUrl + '">reservar el Nivel ' + nivel + '</a>.</p>');
  return { ok: true, yaEstaba: ya };
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
    var sx = sesionDeEvento(ev, 0);
    var que = esPack(res) ? 'tu ' + etiqueta(sx).toLowerCase() + ' (' + res.productoNombre + ')' : 'tu ' + res.productoNombre;
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
      (r.creditoUsado ? ' · crédito del ' + (r.creditoOrigen || 'Diagnóstico') + ' aplicado: ' + pesos(r.creditoUsado) : '') +
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
  var vencidas = {};
  (r.items || []).forEach(function (ev) {
    var p = ev.extendedProperties.private;
    if (Number(p.apv_expira) >= ahora) return;
    if (!vencidas[p.apv_id]) vencidas[p.apv_id] = { r: JSON.parse(p.apv_reserva), inicio: new Date(ev.start.dateTime) };
    else if (new Date(ev.start.dateTime) < vencidas[p.apv_id].inicio) vencidas[p.apv_id].inicio = new Date(ev.start.dateTime);
    Calendar.Events.remove('primary', ev.id);
  });
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('CFG') || '{}');
  Object.keys(vencidas).forEach(function (id) { avisarSinPagar(c, id, vencidas[id].r, vencidas[id].inicio); });
}

// Una reserva que venció sin pago: Muse recibe los datos para el seguimiento y queda en 02 › Captación · Consultas.
function avisarSinPagar(c, id, r, inicio) {
  try {
    var medio = r.medio === 'transferencia' ? 'por transferencia (no llegó el comprobante)' : 'con tarjeta (no completó el pago en Mercado Pago)';
    var cuerpo = '<p>Una reserva de la web venció sin pagar. Es para hacerle seguimiento.</p><ul>' +
      '<li>Músico: ' + r.nombre + '</li><li>WhatsApp: ' + r.whatsapp + '</li><li>Mail: ' + r.email + '</li>' +
      '<li>Propuesta: ' + r.productoNombre + '</li><li>Horario que había elegido: ' + fechaLarga(inicio) + '</li>' +
      '<li>Iba a pagar ' + medio + '</li>' + (r.origen ? '<li>¿Cómo se enteró?: ' + r.origen + '</li>' : '') +
      (r.nota ? '<li>Nota: ' + r.nota + '</li>' : '') + '<li>Código: ' + id + '</li></ul>' +
      '<p>Ya quedó cargada en 02 › Captación · Consultas como «Reserva web sin pagar». Proponele a Fede el mensaje de seguimiento (base: /lopienso, contando que le guardé el horario y que el pago no se completó). Si quiere retomarla, la reserva se hace de nuevo en leeraprimeravista.com/reservar.</p>';
    if (c.muse) enviar(c.muse, 'Reserva web sin pagar · ' + r.productoNombre + ' · ' + r.nombre, cuerpo);
    if (c.ventas) {
      var hoja = SpreadsheetApp.openById(c.ventas).getSheetByName('Captación · Consultas');
      if (hoja) {
        var col = hoja.getRange('A5:A' + hoja.getMaxRows()).getValues(), fila = 5;
        for (var i = 0; i < col.length; i++) { if (col[i][0] === '' || col[i][0] === null) { fila = 5 + i; break; } }
        hoja.getRange(fila, 1, 1, 8).setValues([[new Date(), r.nombre, '', 'Reserva web sin pagar', r.origen || '', '', r.whatsapp, r.email]]);
        hoja.getRange(fila, 14, 1, 2).setValues([[r.productoNombre + ' · ' + fechaLarga(inicio) + ' · ' + medio, 'web · ' + id]]);
      }
    }
  } catch (e) { /* el aviso nunca frena la limpieza */ }
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
function listaSesiones(ses) {
  return '<ul style="padding-left:22px;margin:8px 0">' + ses.map(function (x) {
    return '<li>' + etiqueta(x) + ': ' + fechaLarga(new Date(x.inicio)) + (x.tipo === 'simulacro' ? ' (30 min)' : '') + '</li>';
  }).join('') + '</ul>';
}
function cuantas(ses) {
  var e = ses.filter(function (x) { return x.tipo !== 'simulacro'; }).length, sm = ses.length - e;
  return e + ' encuentros' + (sm ? ' y ' + sm + ' simulacros' : '');
}
function textoPago(r, pago) {
  var t = pago.medio === 'transferencia' ? 'transferencia' : 'tarjeta (Mercado Pago' + (pago.mpId ? ', op. ' + pago.mpId : '') + ')';
  t += ' · ' + pesos(r.ahora);
  if (r.creditoUsado) t += ' (con crédito del ' + (r.creditoOrigen || 'Diagnóstico') + ' de ' + pesos(r.creditoUsado) + ')';
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
function archivoCalendario(r, ses, c) {
  var f = function (d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); };
  var lineas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//A Primera Vista//Reservas//ES', 'METHOD:PUBLISH'];
  ses.forEach(function (x, i) {
    var d = new Date(x.inicio), fin = new Date(x.fin);
    lineas.push('BEGIN:VEVENT', 'UID:apv-' + f(d) + '-' + i + '@leeraprimeravista.com', 'DTSTAMP:' + f(new Date()),
      'DTSTART:' + f(d), 'DTEND:' + f(fin),
      'SUMMARY:' + r.productoNombre + (ses.length > 1 ? ' · ' + etiqueta(x) : '') + ' · A Primera Vista',
      'LOCATION:' + (c.zoom || ''), 'DESCRIPTION:Por Zoom: ' + (c.zoom || ''), 'END:VEVENT');
  });
  lineas.push('END:VCALENDAR');
  return Utilities.newBlob(lineas.join('\r\n'), 'text/calendar', 'encuentros-a-primera-vista.ics');
}

function mailMusicoTransferencia(r, b, c, ses) {
  var cuando = ses.length > 1 ? 'tus ' + cuantas(ses) + ':' + listaSesiones(ses) : 'el turno del <b>' + fechaLarga(new Date(ses[0].inicio)) + '</b> para tu ' + r.productoNombre + '.';
  enviar(r.email, 'Tu ' + r.productoNombre + ': datos para la transferencia',
    '<p>Hola, ' + primerNombre(r) + '.</p>' +
    '<p>Te guardé ' + cuando + '</p>' +
    '<p>Para confirmarlo, transferí <b>' + pesos(r.ahora) + '</b>' + (r.saldo > 0 ? ' (la seña)' : '') + ' a:</p>' +
    '<p>Alias: <b>' + (c.alias || '') + '</b><br>' + (c.cbu ? (c.cbuEtiqueta || 'CBU') + ': ' + c.cbu + '<br>' : '') + (c.titular ? 'Titular: ' + c.titular : '') + '</p>' +
    '<p>Y mandame el comprobante por WhatsApp. ' + (ses.length > 1 ? 'Los turnos quedan guardados' : 'El turno queda guardado') + ' hasta el ' + fechaLarga(new Date(Number(b.expira))) + '.</p>');
}
function mailAvisoTransferencia(r, b, c, ses) {
  enviar(c.avisos, 'Reserva por transferencia · ' + r.productoNombre + ' · ' + r.nombre,
    '<p>' + r.nombre + ' reservó ' + r.productoNombre + (ses.length > 1 ? ' desde el ' + fechaLarga(new Date(ses[0].inicio)) + ' (' + cuantas(ses) + ')' : ' para el ' + fechaLarga(new Date(ses[0].inicio))) +
    ' y va a transferir ' + pesos(r.ahora) + '.</p>' +
    '<p>WhatsApp: ' + r.whatsapp + '</p>' +
    '<p>Cuando veas el comprobante, tocá acá: <a href="' + b.confirmarUrl + '">confirmar la reserva</a>. Si no llega, se libera sola el ' + fechaLarga(new Date(Number(b.expira))) + '.</p>');
}
function mailMusicoConfirmada(r, ses, c, verUrl) {
  var saldo = r.saldo > 0 ? '<p>Quedó paga la seña. El saldo de <b>' + pesos(r.saldo) + '</b> se abona antes del encuentro, por transferencia.</p>' : '';
  var extra = {
    'diagnostico': '<p>No hace falta que prepares nada. Lo único que te pido, antes del Diagnóstico, es este formulario: son 3 minutos y así aprovechamos la media hora para leer. <a href="https://forms.gle/28SgZAuKJDexo27U8">Contame cómo leés hoy</a>.</p>',
    'encuentro-a-medida': '<p>Respondé este mail con la partitura o el material sobre el que querés trabajar, así lo preparo antes.</p>',
  }[r.producto] || '';
  var garantia = /^nivel-/.test(r.producto) ? '<p>La garantía del nivel: «Si al llegar al octavo encuentro todavía no alcanzaste los hitos del nivel, seguimos sin cargo hasta completarlos.»</p>' : '';
  var kit = /^kit-/.test(r.producto) ? '<p>Después de tu audición, sea como sea, nos vemos en una sesión de 30 minutos para repasar cómo te fue (está incluida). Te escribo por WhatsApp para dejarla agendada.</p>' : '';
  var reglaCambio = r.mismaSemana ? 'con 24 h de aviso y dentro de la misma semana (' + maxMov(r) + ' cambio' + (maxMov(r) === 1 ? '' : 's') + ')' : 'con 24 h de aviso (hasta ' + maxMov(r) + ' cambios)';
  var moverUrl = verUrl + '&mover=1';
  if (ses.length > 1) {
    enviar(r.email, 'Confirmado: tu ' + r.productoNombre + ' arranca el ' + diaCorto(new Date(ses[0].inicio)),
      '<p>Hola, ' + primerNombre(r) + '.</p>' +
      '<p>Quedó confirmado tu <b>' + r.productoNombre + '</b>. Tus ' + cuantas(ses) + ', por Zoom (hora de Argentina):</p>' + listaSesiones(ses) +
      '<p>El link de Zoom es el mismo para todos: <a href="' + c.zoom + '">' + c.zoom + '</a><br>Te adjunto un archivo para sumarlos a tu calendario de una vez.</p>' +
      garantia + kit +
      '<p>Si necesitás mover alguno, lo hacés vos desde <a href="' + moverUrl + '">este link</a>, ' + reglaCambio + '. Cualquier otra cosa, escribime por WhatsApp: <a href="https://wa.me/' + c.whatsapp + '">wa.me/' + c.whatsapp + '</a>.</p>',
      [archivoCalendario(r, ses, c)]);
    return;
  }
  enviar(r.email, 'Confirmado: tu ' + r.productoNombre + ' del ' + fechaLarga(new Date(ses[0].inicio)),
    '<p>Hola, ' + primerNombre(r) + '.</p>' +
    '<p>Quedó confirmado tu <b>' + r.productoNombre + '</b>. Nos vemos el <b>' + fechaLarga(new Date(ses[0].inicio)) + '</b> (hora de Argentina), por Zoom.</p>' +
    '<p>Link: <a href="' + c.zoom + '">' + c.zoom + '</a><br>También te llegó la invitación al calendario.</p>' + extra + saldo +
    '<p>Si necesitás mover el horario, lo hacés vos desde <a href="' + moverUrl + '">este link</a>, con 24 h de aviso. Cualquier otra cosa, escribime por WhatsApp: <a href="https://wa.me/' + c.whatsapp + '">wa.me/' + c.whatsapp + '</a>.</p>');
}
// A Muse le llega el aviso de la venta, ya cargada en Ventas, para que sume la ficha del músico.
function mailMuse(r, ses, pago, c, fila) {
  var para = [c.muse, c.avisos].filter(String).join(',');
  var bienvenida = /^nivel-|^kit-/.test(r.producto) ? '<p>Es un recorrido nuevo: seguí el onboarding de siempre (kit de bienvenida y videos).</p>' : '';
  enviar(para, 'Venta web · ' + r.productoNombre + ' · ' + r.nombre,
    '<p>Venta nueva desde leeraprimeravista.com (T43). ' + (fila
      ? 'Ya quedó cargada en 02 · Métricas › Ventas, fila ' + fila + ' (Cargó = Web).'
      : 'No se pudo cargar sola en 02 · Métricas › Ventas.') +
      ' Muse: no la cargues ni crees la ficha (la crea Session Analytics). Si el músico ya tiene ficha, completá solo su Mail.' +
      (fila ? '' : ' Como no se cargó, pasásela al GM con «DE MUSE PARA APV GM | Venta | ' + r.nombre + '» con estos datos.') + '</p>' + bienvenida +
    '<p>Músico: ' + r.nombre + '<br>Producto: ' + r.productoNombre + '<br>' +
    'Pago: Contado · ' + textoPago(r, pago) + (pago.neto ? ' (neto acreditado por MP: ' + pesos(pago.neto) + ')' : '') + '<br>' +
    (ses.length > 1 ? 'Sesiones: ' + ses.map(function (x) { return etiqueta(x) + ' ' + fechaLarga(new Date(x.inicio)); }).join(' · ') : 'Encuentro: ' + fechaLarga(new Date(ses[0].inicio))) +
    (r.audicion ? '<br>Audición: ' + diaCorto(new Date(Number(r.audicion))) + ' (la sesión post-audición se agenda después, sin cobro)' : '') +
    '<br>Mail: ' + r.email + '<br>WhatsApp: ' + r.whatsapp +
    '<br>¿Cómo te enteraste?: ' + (r.origen || '(no lo marcó)') + (r.nota ? '<br>Nota del músico: ' + r.nota : '') + '</p>');
}
