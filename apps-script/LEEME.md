# T43 · Reservas propias (etapa 1)

Reemplazo de Agora para el **Diagnóstico** y el **Encuentro a medida**. Página: `leeraprimeravista.com/reservar/?p=diagnostico` o `?p=encuentro-a-medida`.

## Cómo funciona

1. La página pide los horarios libres a `/api/turnos`. Salen de los horarios de trabajo (lunes y viernes 9-12 y 13-16, miércoles 9-15, cada 60 min, con 24 h de anticipación) menos lo ocupado en los calendarios de Fede, los feriados y media hora de traslado alrededor de los eventos con dirección.
2. Al reservar, `/api/reservar` retiene el turno en el calendario («⏳ Pendiente de pago»).
   - **Tarjeta:** pago en Mercado Pago (1 pago). Al aprobarse, `/api/mp` confirma solo. El turno retenido dura 40 min.
   - **Transferencia** (8 % de descuento): el músico recibe el alias por mail; a Fede le llega un mail con el botón «confirmar la reserva», que toca al ver el comprobante. El turno retenido dura hasta 24 h.
3. Al confirmar: el evento pasa a rojo con el Zoom, el músico recibe la invitación y un mail, y a Muse le llega la venta para cargar en 02 · Métricas › Ventas.
4. Cada 10 minutos, Apps Script libera los turnos retenidos que no se pagaron.

Precios y horarios: `api/_lib.js` (y los textos de `reservar/index.html`). Si cambian en 05 · Precios y reglas, se cambian en los dos.

## Variables de entorno en Vercel

| Variable | Qué es |
| --- | --- |
| `GAS_URL` | URL de la aplicación web de Apps Script (termina en `/exec`) |
| `GAS_SECRET` | La clave que deja `instalar()` en el registro de Apps Script |
| `MP_ACCESS_TOKEN` | Access token de producción de Mercado Pago |
| `ZOOM_URL` | Link de la sala fija de Zoom |
| `TRANSFER_ALIAS`, `TRANSFER_CBU`, `TRANSFER_TITULAR` | Datos para transferir |
| `AVISOS_EMAIL` | Mail de Fede para los avisos |
| `MUSE_EMAIL` | Casilla de AgentMail de Muse |
| `SITE_URL` | `https://leeraprimeravista.com` (opcional) |

Sin `GAS_URL` la página anda en **modo prueba**: muestra horarios de muestra y no cobra ni agenda.

## Apps Script (una sola vez)

1. script.google.com › Proyecto nuevo «APV · Reservas», con la cuenta de Fede.
2. Pegar `Reservas.gs`. En Configuración del proyecto, tildar «Mostrar appsscript.json» y pegar `appsscript.json`.
3. Correr `instalar()` y aceptar los permisos. Copiar del registro la clave (`GAS_SECRET`).
4. Implementar › Nueva implementación › Aplicación web (Ejecutar como: yo · Acceso: cualquier persona). Copiar la URL (`GAS_URL`).
