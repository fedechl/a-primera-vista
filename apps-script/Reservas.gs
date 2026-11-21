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
    var acciones = { ocupado: ocupado, retener: retener, confirmar: confirmar, estado: estado, liberar: liberar, mover: mover };
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

// ¿El horario cae entero dentro de un bloque disponible, fuera de feriados y sin choques?
function libre(ini, fin, sinId) {
  var a = ocupado({ desde: ini - 86400000, hasta: fin + 86400000, sinId: sinId });
  var dia = Utilities.formatDate(new Date(ini), TZ, 'yyyy-MM-dd');
  if (a.feriados.indexOf(dia) >= 0) return false;
  if (!a.disponibles.some(function (d) { return ini >= d.s && fin <= d.e; })) return false;
  return !a.ocupados.some(function (o) { return ini < o.e && fin > o.s; });
}

function buscar(id) {
  var r = Calendar.Events.list('primary', { privateExtendedProperty: 'apv_id=' + id, showDeleted: false, maxResults: 5 });
  return (r.items || [])[0] || null;
}

function retener(b) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ini = Number(b.inicio), fin = Number(b.fin);
    if (!libre(ini, fin)) return { ok: false };
    var r = b.reserva;
    Calendar.Events.insert({
      summary: '⏳ Pendiente de pago · ' + r.productoNombre + ' · ' + r.nombre,
      description: detalleInterno(r, b) + '\n\nSe libera sola si no se paga antes del ' + fechaLarga(new Date(Number(b.expira))) + '.',
      start: { dateTime: new Date(ini).toISOString(), timeZone: TZ },
      end: { dateTime: new Date(fin).toISOString(), timeZone: TZ },
      colorId: COLOR_CLASES,
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: {
        apv_id: b.id, apv_estado: 'pendiente', apv_expira: String(b.expira),
        apv_reserva: JSON.stringify(r).slice(0, 1000), apv_ver: b.verUrl || '',
      } },
    }, 'primary');
  } finally {
    lock.releaseLock();
  }
  var c = b.cfg || {}, rr = b.reserva;
  var transferencia = null;
  if (rr.medio === 'transferencia') {
    transferencia = { alias: c.alias, cbu: c.cbu, cbuEtiqueta: c.cbuEtiqueta || 'CBU', titular: c.titular, monto: rr.ahora, vence: Number(b.expira) };
    mailMusicoTransferencia(rr, b, c);
    mailAvisoTransferencia(rr, b, c);
  }
  return { ok: true, transferencia: transferencia };
}

function confirmar(b) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ev = buscar(b.id);
    if (!ev) {
      // Pago aprobado de un turno que ya se liberó: no se agenda solo, se avisa para resolverlo a mano.
      if (b.pago && b.pago.mpId) enviar((b.cfg || {}).avisos, 'Revisar: pago de una reserva vencida',
        '<p>Mercado Pago aprobó el pago ' + b.pago.mpId + ' (' + pesos(b.pago.monto || 0) + ') de la reserva ' + b.id +
        ', pero el turno ya se había liberado. Coordiná un horario nuevo con el músico o devolvé el pago.</p>');
      return { estado: 'vencida' };
    }
    var p = ev.extendedProperties.private;
    var r = JSON.parse(p.apv_reserva);
    if (p.apv_estado === 'confirmada') return { estado: 'confirmada', yaEstaba: true, nombre: r.nombre };
    var c = b.cfg || {};
    var pago = b.pago || {};
    if (c.zoom) PropertiesService.getScriptProperties().setProperty('ZOOM', c.zoom);
    p.apv_estado = 'confirmada';
    p.apv_pago = JSON.stringify(pago).slice(0, 500);
    Calendar.Events.patch({
      summary: r.productoNombre + ' · ' + r.nombre,
      location: c.zoom || '',
      description: 'Zoom: ' + (c.zoom || '(falta el link)') + '\n\n' + detalleInterno(r, b) + '\nPago: ' + textoPago(r, pago),
      attendees: [{ email: r.email, displayName: r.nombre }],
      reminders: { useDefault: true },
      extendedProperties: { private: p },
    }, 'primary', ev.id, { sendUpdates: 'all' });
    var inicio = new Date(ev.start.dateTime);
    var fila = cargarVenta(r, pago, c, b.id);
    mailMusicoConfirmada(r, inicio, c, p.apv_ver);
    mailMuse(r, inicio, pago, c, fila);
    return { estado: 'confirmada', nombre: r.nombre };
  } finally {
    lock.releaseLock();
  }
}

function estado(b) {
  var ev = buscar(b.id);
  if (!ev) return { estado: 'vencida' };
  var p = ev.extendedProperties.private, r = JSON.parse(p.apv_reserva);
  return {
    estado: p.apv_estado, producto: r.productoNombre, productoClave: r.producto, nombre: r.nombre, medio: r.medio,
    movimientos: Number(p.apv_mov || 0), puedeMover: p.apv_estado === 'confirmada' && Number(p.apv_mov || 0) < MAX_MOVIMIENTOS &&
      new Date(ev.start.dateTime).getTime() - Date.now() >= 86400000,
    inicio: new Date(ev.start.dateTime).getTime(), cuando: fechaLarga(new Date(ev.start.dateTime)),
    ahora: r.ahora, saldo: r.saldo,
  };
}

function liberar(b) {
  var ev = buscar(b.id);
  if (ev && ev.extendedProperties.private.apv_estado === 'pendiente') Calendar.Events.remove('primary', ev.id);
  return { ok: true };
}

// El músico mueve su encuentro: con 24 h de aviso y hasta 2 veces por reserva.
function mover(b) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ev = buscar(b.id);
    if (!ev) return { ok: false, motivo: 'No encuentro la reserva.' };
    var p = ev.extendedProperties.private, r = JSON.parse(p.apv_reserva);
    var mov = Number(p.apv_mov || 0), antes = new Date(ev.start.dateTime);
    if (p.apv_estado !== 'confirmada') return { ok: false, motivo: 'La reserva todavía no está confirmada.' };
    if (antes.getTime() - Date.now() < 86400000) return { ok: false, motivo: 'Falta menos de 24 h: para moverlo, escribime por WhatsApp.' };
    if (mov >= MAX_MOVIMIENTOS) return { ok: false, motivo: 'Ya lo moviste ' + MAX_MOVIMIENTOS + ' veces: escribime por WhatsApp y lo vemos.' };
    var ini = Number(b.inicio), fin = Number(b.fin);
    if (!libre(ini, fin, b.id)) return { ok: false, motivo: 'Ese horario se acaba de ocupar. Elegí otro.' };
    p.apv_mov = String(mov + 1);
    p.apv_recordado = '';
    Calendar.Events.patch({
      start: { dateTime: new Date(ini).toISOString(), timeZone: TZ },
      end: { dateTime: new Date(fin).toISOString(), timeZone: TZ },
      extendedProperties: { private: p },
    }, 'primary', ev.id, { sendUpdates: 'all' });
    var c = b.cfg || {};
    enviar(r.email, 'Movido: tu ' + r.productoNombre + ' pasa al ' + fechaLarga(new Date(ini)),
      '<p>Hola, ' + primerNombre(r) + '.</p><p>Listo: tu ' + r.productoNombre + ' pasó del ' + fechaLarga(antes) + ' al <b>' + fechaLarga(new Date(ini)) +
      '</b> (hora de Argentina). El link de Zoom es el mismo: <a href="' + c.zoom + '">' + c.zoom + '</a>.</p>');
    enviar(c.avisos, 'Reserva movida · ' + r.productoNombre + ' · ' + r.nombre,
      '<p>' + r.nombre + ' movió su ' + r.productoNombre + ' del ' + fechaLarga(antes) + ' al ' + fechaLarga(new Date(ini)) + ' (cambio ' + (mov + 1) + ' de ' + MAX_MOVIMIENTOS + ').</p>');
    return { ok: true, cuando: fechaLarga(new Date(ini)) };
  } finally {
    lock.releaseLock();
  }
}

// Cada hora: recordatorio al músico 24 h antes de su encuentro.
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
    enviar(res.email, 'Mañana: tu ' + res.productoNombre,
      '<p>Hola, ' + primerNombre(res) + '.</p><p>Te recuerdo tu <b>' + res.productoNombre + '</b>: <b>' + fechaLarga(ini) + '</b> (hora de Argentina).</p>' +
      '<p>Link de Zoom: <a href="' + (ev.location || zoom) + '">' + (ev.location || zoom) + '</a></p>' +
      (res.saldo > 0 ? '<p>Acordate de transferir el saldo de ' + pesos(res.saldo) + ' antes del encuentro.</p>' : '') + '<p>Nos vemos.</p>');
    p.apv_recordado = '1';
    Calendar.Events.patch({ extendedProperties: { private: p } }, 'primary', ev.id);
  });
}

// La venta va sola a 02 · Métricas › Ventas: primera fila vacía, columnas A a H (I es fórmula).
// Monto = el neto (lo que acredita Mercado Pago o lo transferido), como pide la regla de Ventas.
function cargarVenta(r, pago, c, id) {
  if (!c.ventas) return null;
  try {
    var hoja = SpreadsheetApp.openById(c.ventas).getSheetByName('Métricas · Ventas');
    var col = hoja.getRange('A5:A404').getValues();
    var i = 0;
    while (i < col.length && col[i][0] !== '') i++;
    if (i >= col.length) return null;
    var producto = { 'diagnostico': 'Diagnóstico', 'encuentro-a-medida': 'Encuentro suelto' }[r.producto] || r.productoNombre;
    var origen = r.origen === 'Ya trabajé con Fede' ? 'Músico pasado' : (r.origen || '');
    var monto = pago.neto || pago.monto || r.ahora;
    var notas = 'Reserva web (T43), código ' + id + ' · medio: ' + (pago.medio || r.medio) + (pago.mpId ? ', op. MP ' + pago.mpId : '') +
      (r.saldo > 0 ? ' · seña; saldo ' + pesos(r.saldo) + ' (se carga aparte al cobrarlo)' : '') +
      (r.origen === 'Ya trabajé con Fede' ? ' · origen: «ya trabajé con Fede» (revisar si es activo o pasado)' : '') +
      (r.origen ? '' : ' · origen: no lo marcó en la reserva');
    hoja.getRange(i + 5, 1, 1, 8).setValues([[new Date(), r.nombre, producto, origen, 'Contado', Math.round(monto), 'Web', notas]]);
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
function textoPago(r, pago) {
  var t = pago.medio === 'transferencia' ? 'transferencia' : 'tarjeta (Mercado Pago' + (pago.mpId ? ', op. ' + pago.mpId : '') + ')';
  t += ' · ' + pesos(r.ahora);
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
function enviar(para, asunto, html) {
  if (!para) return;
  MailApp.sendEmail({ to: para, subject: asunto, htmlBody: envolver(html), name: 'Fede · A Primera Vista' });
}
function primerNombre(r) { return String(r.nombre).split(' ')[0]; }

function mailMusicoTransferencia(r, b, c) {
  enviar(r.email, 'Tu ' + r.productoNombre + ': datos para la transferencia',
    '<p>Hola, ' + primerNombre(r) + '.</p>' +
    '<p>Te guardé el turno del <b>' + fechaLarga(new Date(Number(b.inicio))) + '</b> para tu ' + r.productoNombre + '.</p>' +
    '<p>Para confirmarlo, transferí <b>' + pesos(r.ahora) + '</b>' + (r.saldo > 0 ? ' (la seña)' : '') + ' a:</p>' +
    '<p>Alias: <b>' + (c.alias || '') + '</b><br>' + (c.cbu ? (c.cbuEtiqueta || 'CBU') + ': ' + c.cbu + '<br>' : '') + (c.titular ? 'Titular: ' + c.titular : '') + '</p>' +
    '<p>Y mandame el comprobante por WhatsApp. El turno queda guardado hasta el ' + fechaLarga(new Date(Number(b.expira))) + '.</p>');
}
function mailAvisoTransferencia(r, b, c) {
  enviar(c.avisos, 'Reserva por transferencia · ' + r.productoNombre + ' · ' + r.nombre,
    '<p>' + r.nombre + ' reservó ' + r.productoNombre + ' para el ' + fechaLarga(new Date(Number(b.inicio))) + ' y va a transferir ' + pesos(r.ahora) + '.</p>' +
    '<p>WhatsApp: ' + r.whatsapp + '</p>' +
    '<p>Cuando veas el comprobante, tocá acá: <a href="' + b.confirmarUrl + '">confirmar la reserva</a>. Si no llega, el turno se libera solo el ' + fechaLarga(new Date(Number(b.expira))) + '.</p>');
}
function mailMusicoConfirmada(r, inicio, c, verUrl) {
  var saldo = r.saldo > 0 ? '<p>Quedó paga la seña. El saldo de <b>' + pesos(r.saldo) + '</b> se abona antes del encuentro, por transferencia.</p>' : '';
  var material = r.producto === 'encuentro-a-medida' ? '<p>Si querés que trabajemos sobre una partitura tuya, respondé este mail con el archivo así lo preparo antes.</p>' : '';
  enviar(r.email, 'Confirmado: tu ' + r.productoNombre + ' del ' + fechaLarga(inicio),
    '<p>Hola, ' + primerNombre(r) + '.</p>' +
    '<p>Quedó confirmado tu <b>' + r.productoNombre + '</b>: <b>' + fechaLarga(inicio) + '</b> (hora de Argentina), por Zoom.</p>' +
    '<p>Link: <a href="' + c.zoom + '">' + c.zoom + '</a><br>También te llegó la invitación al calendario.</p>' + saldo + material +
    '<p>Si necesitás mover el horario, lo podés hacer vos desde <a href="' + verUrl + '&mover=1">este link</a>, con 24 h de anticipación (hasta 2 veces). Cualquier otra cosa, escribime por WhatsApp: <a href="https://wa.me/' + c.whatsapp + '">wa.me/' + c.whatsapp + '</a>.</p>');
}
// A Muse le llega el aviso de la venta, ya cargada en Ventas, para que sume la ficha del músico.
function mailMuse(r, inicio, pago, c, fila) {
  var para = [c.muse, c.avisos].filter(String).join(',');
  enviar(para, 'Venta web · ' + r.productoNombre + ' · ' + r.nombre,
    '<p>Venta nueva desde leeraprimeravista.com (T43). ' + (fila
      ? 'Ya quedó cargada en 02 · Métricas › Ventas, fila ' + fila + ' (Cargó = Web). Muse: no la cargues de nuevo; sumá o actualizá la ficha del músico y revisá el Origen.'
      : 'No se pudo cargar sola en 02 · Métricas › Ventas: Muse, cargala vos con estos datos.') + '</p>' +
    '<p>Músico: ' + r.nombre + '<br>Producto: ' + r.productoNombre + '<br>' +
    'Pago: Contado · ' + textoPago(r, pago) + (pago.neto ? ' (neto acreditado por MP: ' + pesos(pago.neto) + ')' : '') + '<br>' +
    'Encuentro: ' + fechaLarga(inicio) + '<br>Mail: ' + r.email + '<br>WhatsApp: ' + r.whatsapp +
    '<br>¿Cómo te enteraste?: ' + (r.origen || '(no lo marcó)') + (r.nota ? '<br>Nota del músico: ' + r.nota : '') + '</p>');
}
