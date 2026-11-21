// GET /api/confirmar?id=…&k=… · el link del mail de aviso: Fede lo toca cuando le llega el comprobante
// de una transferencia. Confirma la reserva, le avisa al músico y le pasa la venta a Muse.
import { firmaValida, gas } from './_lib.js';

const pagina = (titulo, texto) => `<!doctype html><html lang="es-AR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title>
<body style="font-family:Georgia,serif;background:#F5F7FA;color:#052E5E;padding:48px 20px;max-width:560px;margin:auto;font-size:19px;line-height:1.6">
<p style="color:#CD9E34">A Primera Vista</p><h1 style="font-weight:500">${titulo}</h1><p>${texto}</p></body></html>`;

export default async function handler(req, res) {
  const { id, k } = req.query || {};
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!firmaValida('confirmar', id, k)) { res.statusCode = 403; return res.end(pagina('Link inválido', 'Este link no corresponde a ninguna reserva.')); }
  // Con GET solo se muestra el botón: así un antivirus que abre los links del mail no confirma nada.
  if (req.method !== 'POST') {
    return res.end(pagina('¿Llegó la transferencia?', `Tocá el botón solo si ya viste el comprobante.</p>
<form method="post"><button style="font:inherit;font-weight:600;background:#CD9E34;color:#031F41;border:0;border-radius:999px;padding:14px 28px">Sí, confirmar la reserva</button></form><p>`));
  }
  try {
    const r = await gas('confirmar', { id, pago: { medio: 'transferencia' } });
    if (r.estado === 'vencida') return res.end(pagina('La reserva venció', 'El turno ya se liberó. Si el pago llegó igual, coordiná un horario nuevo con el músico.'));
    return res.end(pagina('Listo, confirmada', r.yaEstaba
      ? 'Esta reserva ya estaba confirmada. No se mandó nada de nuevo.'
      : `Le llegó la confirmación a ${r.nombre || 'el músico'} y Muse recibió la venta para cargarla.`));
  } catch (e) {
    console.error(e);
    res.statusCode = 502;
    return res.end(pagina('No se pudo confirmar', 'Probá de nuevo en un rato.'));
  }
}
