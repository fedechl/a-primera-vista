# T43 · Reservas propias (etapa 1)

Reemplazo de Agora para el **Diagnóstico** y el **Encuentro a medida**. Página: `leeraprimeravista.com/reservar/?p=diagnostico` o `?p=encuentro-a-medida`.

## Cómo funciona

1. La página pide los horarios libres a `/api/turnos`. Salen del calendario **«APV · Disponibilidad»** (los bloques «Disponible» que Fede marca semana a semana; arranca con los mismos horarios que tenía Agora, repetidos cada semana), cada 60 min y con 24 h de anticipación, menos lo ocupado en los demás calendarios de Fede, los feriados y media hora de traslado alrededor de los eventos con dirección. Vacaciones: un evento de día completo marcado como ocupado, o borrar esos bloques.
2. Al reservar, `/api/reservar` retiene el turno en el calendario («⏳ Pendiente de pago»).
   - **Tarjeta:** pago en Mercado Pago (1 pago). Al aprobarse, `/api/mp` confirma solo. El turno retenido dura 40 min.
   - **Transferencia** (8 % de descuento): el músico recibe el alias por mail; a Fede le llega un mail con el botón «confirmar la reserva», que toca al ver el comprobante. El turno retenido dura hasta 24 h.
3. Al confirmar: el evento pasa a rojo con el Zoom, el músico recibe la invitación y un mail, la venta se carga sola en 02 · Métricas › Ventas (Cargó = Web, Monto = neto) y a Muse le llega el aviso para la ficha.
4. El músico puede mover su encuentro desde el mail (`/reservar/?id=…&mover=1`): con 24 h de aviso y hasta 2 veces.
5. Cada 10 minutos, Apps Script libera los turnos retenidos que no se pagaron. Cada hora manda el recordatorio de las 24 h.

Precios y horarios: `api/_lib.js` (y los textos de `reservar/index.html`). Si cambian en 05 · Precios y reglas, se cambian en los dos.

Versión publicada del Apps Script: 13 (21/11/2026: clave antes de la configuración; crédito del Diagnóstico desde el Diagnóstico; mail «Venta web» alineado con Muse; Niveles 2 y 3 por Fichas recién con el encuentro 8; post-audición: «te escribo para dejarla agendada»). Versión 13.

## Variables de entorno en Vercel

| Variable | Qué es |
| --- | --- |
| `GAS_URL` | URL de la aplicación web de Apps Script (termina en `/exec`) |
| `GAS_SECRET` | La clave que deja `instalar()` en el registro de Apps Script |
| `MP_ACCESS_TOKEN` | Access token de producción de Mercado Pago |
| `ZOOM_URL` | Link de la sala fija de Zoom |
| `TRANSFER_ALIAS`, `TRANSFER_CBU`, `TRANSFER_TITULAR`, `TRANSFER_CBU_ETIQUETA` | Datos para transferir (la etiqueta es «CBU» o «CVU») |
| `AVISOS_EMAIL` | Mail de Fede para los avisos |
| `MUSE_EMAIL` | Casilla de AgentMail de Muse |
| `VENTAS_SHEET_ID` | ID de 02 · Métricas de impacto |
| `SITE_URL` | `https://leeraprimeravista.com` (opcional) |

Sin `GAS_URL` la página anda en **modo prueba**: muestra horarios de muestra y no cobra ni agenda.

## Apps Script (una sola vez)

1. script.google.com › Proyecto nuevo «APV · Reservas», con la cuenta de Fede.
2. Pegar `Reservas.gs`. En Configuración del proyecto, tildar «Mostrar appsscript.json» y pegar `appsscript.json`.
3. Correr `instalar()` y aceptar los permisos. Crea el calendario «APV · Disponibilidad» y los activadores. Copiar del registro la clave (`GAS_SECRET`).
4. Implementar › Nueva implementación › Aplicación web (Ejecutar como: yo · Acceso: cualquier persona). Copiar la URL (`GAS_URL`).
