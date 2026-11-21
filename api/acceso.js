// Acceso a los Niveles 2 y 3 de Navegar la Partitura: se reservan al terminar el nivel anterior.
// POST {accion:'verificar', p, email}          → le llega al músico un mail: link para reservar o para pedir acceso
// POST {accion:'verificar', p, email, k}       → desde ese link: { ok, desde } (desde: fin del nivel anterior)
// POST {accion:'pedir', p, email, nombre, k}   → desde el link del mail: le llega a Fede el botón para habilitarlo
// GET  ?email=…&n=…&nombre=…&k=…               → el link de ese mail: muestra un botón (POST) para habilitar
import { PRODUCTOS, firmar, firmaValida, gas, json, leerCuerpo, modoPrueba, sitio } from './_lib.js';

const limpiar = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const mailOk = (m) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m);

const pagina = (titulo, texto) => `<!doctype html><html lang="es-AR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title>
<body style="font-family:Georgia,serif;background:#F5F7FA;color:#052E5E;padding:48px 20px;max-width:560px;margin:auto;font-size:19px;line-height:1.6">
<p style="color:#CD9E34">A Primera Vista</p><h1 style="font-weight:500">${titulo}</h1><p>${texto}</p></body></html>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async function handler(req, res) {
  // Link del mail de Fede: GET muestra el botón, POST habilita (así un antivirus que abre el link no habilita nada).
  if (req.query && req.query.k) {
    const email = limpiar(req.query.email, 120).toLowerCase();
    const n = Number(req.query.n);
    const nombre = limpiar(req.query.nombre, 80);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (![2, 3].includes(n) || !firmaValida('habilitar', email + '|' + n, req.query.k)) {
      res.statusCode = 403; return res.end(pagina('Link inválido', 'Este link no corresponde a ningún pedido.'));
    }
    if (req.method !== 'POST') {
      return res.end(pagina(`¿Habilitar el Nivel ${n}?`, `${esc(nombre || email)} (${esc(email)}) va a poder reservar el Nivel ${n} y le llega un mail con el link.</p>
<form method="post"><button style="font:inherit;font-weight:600;background:#CD9E34;color:#031F41;border:0;border-radius:999px;padding:14px 28px">Sí, habilitar</button></form><p>`));
    }
    try {
      const r = await gas('habilitar', { email, nombre, nivel: n, reservarUrl: `${sitio()}/reservar/?p=nivel-${n}&acceso=${encodeURIComponent(email)}&k=${firmar('acceso', email + '|' + n)}` });
      return res.end(pagina('Listo, habilitado', r.yaEstaba
        ? `${esc(nombre || email)} ya estaba habilitado. Le volvió a llegar el link para reservar.`
        : `A ${esc(nombre || email)} le llegó un mail con el link para reservar el Nivel ${n}.`));
    } catch (e) {
      console.error(e); res.statusCode = 502;
      return res.end(pagina('No se pudo habilitar', 'Probá de nuevo en un rato.'));
    }
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido.' });
  const b = await leerCuerpo(req);
  const p = PRODUCTOS[b.p];
  const email = limpiar(b.email, 120).toLowerCase();
  if (!p || !p.requiere) return json(res, 400, { error: 'Propuesta desconocida.' });
  if (!mailOk(email)) return json(res, 400, { error: 'Revisá tu mail.' });
  const nivel = p.requiere + 1;
  if (modoPrueba()) return json(res, 200, { ok: true, prueba: true, desde: 0 });

  try {
    const clave = email + '|' + nivel;
    // Pedir acceso: solo desde el link del mail (así nadie le llena la casilla a Fede).
    if (b.accion === 'pedir') {
      if (!firmaValida('pedir', clave, b.k)) return json(res, 403, { error: 'Este link no es válido. Volvé a poner tu mail en la página de reservas.' });
      const nombre = limpiar(b.nombre, 80);
      if (!nombre) return json(res, 400, { error: 'Falta tu nombre.' });
      const k = firmar('habilitar', clave);
      const habilitarUrl = `${sitio()}/api/acceso?email=${encodeURIComponent(email)}&n=${nivel}&nombre=${encodeURIComponent(nombre)}&k=${k}`;
      const r = await gas('pedirAcceso', { email, nombre, nivel, habilitarUrl });
      return json(res, 200, { ok: true, yaEsta: !!r.yaEsta });
    }
    // Desde el link del mail «Tu link para reservar»: ahí sí se confirma en pantalla.
    if (b.k) {
      if (!firmaValida('acceso', clave, b.k)) return json(res, 403, { error: 'Este link no es válido. Volvé a poner tu mail.' });
      const r = await gas('habilitado', { email, nivel });
      if (r.error) throw new Error(r.error);
      return json(res, 200, { ok: !!r.ok, desde: r.desde || 0 });
    }
    // Sin link: la respuesta va al mail, la pantalla no dice si es cliente o no (21/11/2026).
    const base = `${sitio()}/reservar/?p=nivel-${nivel}`;
    await gas('accesoPorMail', {
      email, nivel, volverUrl: base,
      reservarUrl: `${base}&acceso=${encodeURIComponent(email)}&k=${firmar('acceso', clave)}`,
      pedirUrl: `${base}&pedir=${encodeURIComponent(email)}&k=${firmar('pedir', clave)}`,
    });
    return json(res, 200, { ok: true, enviado: true });
  } catch (e) {
    console.error(e);
    return json(res, 502, { error: 'No pude revisarlo ahora. Probá de nuevo en un rato.' });
  }
}
