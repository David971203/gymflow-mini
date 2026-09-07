# Auditoría de flujos actuales de GymFlow Mini

Fecha de revisión: 7 de septiembre de 2026.

Actualización: los puntos 1, 2, 4, 5 y 6 del orden recomendado fueron corregidos después de esta revisión. Se conservan abajo como registro del problema y de la decisión aplicada.

## Resultado ejecutivo

La aplicación tiene una base coherente para el piloto: separación por gimnasio, permisos efectivos en el backend, vencimiento por día de La Habana, cobros con movimientos inmutables, prevención de sobrepagos y una cola offline idempotente. El backend compila y sus 115 pruebas pasan; la aplicación móvil también pasa TypeScript.

Después de las correcciones aplicadas, queda un recorrido prioritario que todavía puede presentar un estado incompleto:

1. miembros que solo reciben la última membresía en el snapshot.

El panel web compila y sus 3 pruebas pasan después de alinear las expectativas con los textos y la confirmación actuales.

## Mapa y veredicto de los flujos

| Flujo | Estado | Observación |
|---|---|---|
| Primera instalación y bienvenida | Bien definido | Tres pantallas, continuar, omitir y persistencia local. |
| Autorregistro | Bien definido con ajustes menores | Crea gimnasio y administrador en una transacción; falta validar el formato del correo antes del último envío. |
| Verificación de correo | Bien definido | Código con vencimiento, límite de intentos y reenvío genérico. |
| Inicio de sesión | Bien definido | Rechaza cuenta, gimnasio o rol no válidos. |
| Recuperación de contraseña | Funciona, con riesgo | El backend revela si un correo existe. |
| Alta desde superadministración | Incompleto | Se crea una cuenta no verificada, pero el código solo se envía después de que el usuario intenta entrar y falla. |
| Selección inicial de suscripción | Funciona, con inconsistencia | “Elegir otro plan” solo oculta localmente la solicitud; no la cancela en el servidor. |
| Renovación y cambio de suscripción | Mayormente bien definido | Respeta ventana de tres días y conserva el plan vigente; revisar fechas de fin de mes. |
| Vencimiento de suscripción | Bien definido | Escrituras bloqueadas y lecturas permitidas; el día de vencimiento sigue completo. |
| Restauración de sesión/offline | Inconsistente | Un 401 durante el uso borra las credenciales, pero no saca al usuario de la interfaz abierta. |
| Planes del gimnasio | Funciona, con validación desigual | Web valida enteros y dos decimales; móvil deja que el backend descubra varios errores. |
| Alta de miembro con plan | Inconsistente | Miembro y membresía no se crean como una sola unidad lógica. |
| Edición/archivo de miembro | Corregido | El estado ya no se edita manualmente; se deriva de las membresías. |
| Foto del miembro | Corregido | La foto se trata como paso posterior y un fallo no invalida el alta o edición ya confirmada. |
| Asignación/cancelación/renovación | Bien definida en el caso simple | Mantiene cobro e historial; falla la representación cuando existen membresías activa y programada. |
| Cobros y abonos | Base sólida | Impide sobrepago y usa idempotencia; debe endurecerse la fecha recibida desde el dispositivo. |
| Dashboard y finanzas | Corregido | Distingue saldo total, por cobrar hoy, vencido y futuro con la misma regla de fecha. |
| Recepcionista | Backend definido, UI oculta | Los permisos son razonables, pero el alta valida el correo como verificado sin intervención del trabajador. |
| Asistencia | Backend definido, UI oculta | Sigue siendo una superficie activa aunque no exista navegación visible. |
| Panel de superadministración | Funciona, con huecos | Compila; no expulsa automáticamente una sesión caducada y su prueba de metadatos está desactualizada. |

## Hallazgos prioritarios

### P1. Alta de miembro y membresía no atómica — RESUELTO

En Android se guarda el miembro, se fuerza una sincronización y después se asigna el plan. En el panel web también se hacen dos peticiones consecutivas. Si la segunda operación falla, queda un miembro sin membresía aunque la interfaz exige un plan y anuncia “Miembro y membresía registrados/creado con su plan inicial”.

Existe además un caso específico offline: si el alta se fusiona con otro CI ya creado en otro dispositivo, la sincronización sustituye el UUID local por el canónico antes de que se encole la membresía. El formulario conserva el UUID anterior y la asignación puede fallar con “no se encontró el miembro”. Esto contradice el flujo de remapeo documentado para operaciones posteriores.

Solución aplicada: Android encola una operación compuesta y el panel web llama a un endpoint compuesto. Miembro, membresía, cobro y abono inicial se confirman dentro de una única transacción del servidor. Si cualquier parte falla, no se confirma un alta parcial.

### P1. La sesión móvil puede morir sin cerrar la interfaz — RESUELTO

La aplicación consulta el perfil periódicamente. Ante un 401, `api.restore()` elimina token y sesión, pero `AdminApp.refreshProfile()` captura y silencia el error. El usuario permanece en las pantallas operativas y puede generar cambios locales que ya no se podrán enviar. Esto ocurrirá, por ejemplo, al vencer el JWT de 12 horas, tras cambiar la contraseña desde otro lugar o cuando la cuenta deje de ser válida.

Solución aplicada: el transporte distingue cualquier respuesta 401, elimina las credenciales y notifica a la raíz de la aplicación para volver inmediatamente al login. Los fallos de conectividad siguen conservando la sesión offline.

### P1. El snapshot entrega una sola membresía por miembro

Las consultas usadas por Android y por la lista del panel cargan `take: 1`. Si existe una renovación programada más reciente, puede ocultarse la membresía activa anterior. El cliente recalcula entonces al miembro como inactivo y deja de mostrar/cancelar correctamente la membresía vigente.

Recomendación: devolver al menos la membresía activa, la programada y la última histórica, o devolverlas todas para el volumen del piloto. No elegir únicamente por `createdAt`.

### P1. “Sincronizado” no significa necesariamente “aceptado” — RESUELTO

`syncNow()` convierte rechazos de reglas de negocio en incidencias y devuelve un estado; no lanza una excepción. Varias pantallas esperan esa función y después muestran “actualizado correctamente”. Un cambio puede ser revertido por el snapshot y aun así producir una confirmación verde.

Solución aplicada: cada mutación relevante conserva su identificador y consulta específicamente su resultado. La UI muestra éxito solo cuando esa operación fue aceptada, aviso amarillo cuando quedó pendiente offline y rechazo con el motivo cuando el servidor no la aceptó.

### P1. Guardar datos y foto es una operación parcial — RESUELTO

La creación/edición se sincroniza antes de subir o eliminar la foto. Si la subida falla, el miembro y posiblemente su membresía ya quedaron guardados, pero el formulario informa un error general y permite reintentar todo. El reintento puede terminar en un CI duplicado o en una segunda acción innecesaria.

Solución aplicada: la operación principal se confirma primero. Si queda pendiente offline, la aplicación cierra el formulario e informa que la foto no fue guardada. Si el servidor acepta los datos pero la subida o eliminación de la imagen falla, se conserva el alta o edición, se muestra “datos guardados; foto pendiente” y el usuario puede reintentar únicamente la foto desde Editar datos.

## Hallazgos importantes

### P2. Dos fuentes de verdad para el estado del miembro — RESUELTO

La UI y el DTO permiten cambiar manualmente `Member.status`, mientras el motor offline y el proceso nocturno lo recalculan desde las membresías. Así se puede guardar `INACTIVE` con membresía activa o `ACTIVE` sin membresía vigente; después distintas pantallas pueden corregirlo o mostrarlo de forma diferente.

Solución aplicada: se eliminó `status` de la edición de miembro en Android, superadministración, DTO y cola offline. Un alta sin membresía nace inactiva; las altas con plan y toda edición, cancelación o eliminación de membresía reconcilian el estado del miembro según exista una membresía vigente. El estado de la membresía también se deriva de sus fechas, salvo la cancelación explícita. La separación futura de “archivado” mediante `archivedAt` sigue siendo una mejora de modelo, pero ya no existe una segunda fuente editable para el acceso vigente.

### P2. Abandonar una solicitud de suscripción solo cambia la pantalla

En la selección inicial, “Elegir otro plan” reemplaza `subscriptionRequest` por `null` solo en memoria. Si el usuario cierra y vuelve a abrir, reaparece la solicitud pendiente del servidor. Al escoger otro plan sí se cancela la anterior, pero el botón actual comunica más de lo que hace.

Recomendación: añadir cancelación explícita del request o renombrar la acción a “Volver a ver planes”, explicando que la solicitud sigue pendiente hasta reemplazarla.

### P2. Deuda futura visible en métricas pero oculta en Cobros móvil — RESUELTO

La pantalla móvil excluye cobros cuya fecha de vencimiento todavía no llegó. El dashboard y las finanzas suman todos los saldos, incluidos los de renovaciones programadas. Por tanto, “Total por cobrar” y “Deuda pendiente” pueden no coincidir el mismo día.

Solución aplicada: todos los resúmenes usan la fecha de vencimiento por día de La Habana y separan `por cobrar hoy` —incluye lo vencido y lo que vence hoy—, `deuda vencida` y `saldo futuro`. Finanzas conserva además `saldo pendiente total` como la suma de los tres estados. Android muestra únicamente cobros exigibles en la lista, pero presenta el saldo futuro por separado para que el total no parezca contradictorio.

### P2. Fechas financieras controladas por el reloj del dispositivo

Las operaciones offline envían `occurredAt` desde el teléfono y el backend lo acepta para ubicar ingresos y movimientos. La protección de 72 horas reduce el riesgo, pero no impide adelantar la hora o atribuir un pago a otro mes.

Recomendación: validar una tolerancia respecto al tiempo del servidor y guardar tanto `occurredAt` como `receivedAt`; los cierres financieros deberían usar una política explícita.

### P2. Cambio de contraseña desde superadministración no invalida sesiones anteriores

El cambio realizado por el propio usuario o para una recepcionista incrementa `tokenVersion`. `updateGymAdmin()` cambia el hash sin incrementarlo, por lo que las sesiones previas del administrador siguen válidas hasta que venza el JWT. Desactivar la cuenta sí queda bloqueado porque la estrategia consulta `isActive` en cada petición.

Recomendación: incrementar `tokenVersion` también cuando el superadministrador cambia la contraseña de un administrador.

### P2. Verificación desigual según quién crea la cuenta

- Autorregistro: correo verificado correctamente.
- Administrador creado desde el panel: queda sin verificar y no recibe código hasta intentar entrar.
- Recepcionista creada desde la app: queda marcada como verificada de inmediato, aunque el correo lo escribió otra persona.

Recomendación: unificarlo como invitación: el creador indica correo y rol; el destinatario verifica el correo y define su propia contraseña.

### P2. Recuperación de contraseña permite enumerar cuentas

El reenvío de verificación responde de forma genérica, pero “Olvidé mi contraseña” devuelve 404 cuando el correo no existe o está inactivo. Esto permite comprobar qué correos tienen cuenta.

Recomendación: responder siempre con el mismo mensaje y estado, haya o no una cuenta elegible.

### P2. No hay tiempo límite para peticiones HTTP

Los clientes usan `fetch` sin cancelación ni timeout. Una red cubana conectada pero sin respuesta puede dejar formularios en “Guardando”, “Entrando” o “Comprobando” indefinidamente.

Recomendación: usar `AbortController`, un límite razonable y mensajes que distingan timeout, sin red y rechazo del servidor.

## Ajustes de consistencia y experiencia

### P3. Calendario mensual y anual

Las suscripciones usan `Date.setMonth()` y `Date.setFullYear()`. Fechas como 31 de enero o 29 de febrero pueden desbordarse a marzo. Se debe decidir si “un mes” significa mismo día del mes con ajuste al último día disponible, o una cantidad fija de días, y probar los extremos.

### P3. Validación móvil de planes

La app móvil solo comprueba que precio y días sean mayores que cero; el backend exige máximo dos decimales e integer para días. El error aparece tarde, al guardar. Conviene reflejar exactamente las mismas reglas en el formulario.

### P3. Archivar miembros inactivos

La acción Archivar solo aparece cuando `member.status === ACTIVE`. Un miembro que ya quedó inactivo no puede archivarse desde Android, aunque sea precisamente el candidato natural para limpieza/archivo.

### P3. Actualización de membresía programada offline

La validación local compara lo abonado con el precio de un solo período, mientras el backend lo compara con `precio × periodCount`. En una membresía de varios períodos la app puede rechazar un cambio que el servidor permitiría. La interfaz programada está oculta, pero el código y los endpoints siguen activos.

### P3. Funciones ocultas no equivalen a funciones desactivadas

“Personal y acceso” y Asistencia no tienen entrada visible, pero sus componentes, rutas y endpoints continúan activos. Esto es válido como feature flag temporal, siempre que se documente que están ocultos y no eliminados. Si no se quieren probar todavía, conviene desactivarlos también mediante una bandera de backend o excluirlos de la compilación del piloto.

### P3. Documentación y pruebas desalineadas

El README dice que ambos endpoints de sincronización requieren `ADMIN`, pero el controlador admite `ADMIN` y `RECEPTIONIST`, aplicando restricciones por tipo de operación. Además, la prueba web espera el texto “Buscar solicitudes de planes”, mientras la interfaz ya usa “Buscar solicitudes de suscripción”.

## Lo que está correctamente protegido

- El gimnasio efectivo sale del JWT; los endpoints operativos no confían en un `gymId` enviado por Android.
- La estrategia JWT comprueba `isActive` y `tokenVersion` en cada petición.
- El backend bloquea escrituras con suscripción vencida y permite consulta.
- Los cambios de contraseña del propio usuario invalidan otras sesiones.
- La expiración activa membresías programadas, vence las antiguas y reconcilia el estado del miembro.
- La asignación de membresía crea su cobro en transacción del servidor.
- Los abonos no pueden superar el saldo y usan control optimista/idempotencia.
- Cancelar una membresía conserva correctamente su cobro y sus movimientos.
- El backend impide borrar el único administrador activo de un gimnasio.
- Recepción no puede crear/modificar planes ni borrar miembros o membresías.

## Orden recomendado antes de ampliar el modelo

1. Corregir cierre de sesión ante 401 durante el uso.
2. Hacer atómico el alta miembro + membresía y separar la foto. **Resuelto.**
3. Entregar correctamente membresía activa + programada en snapshots/listas.
4. Hacer que las confirmaciones reflejen aceptación real o estado pendiente.
5. Eliminar la edición manual ambigua de `Member.status`. **Resuelto.**
6. Unificar las definiciones de deuda presente/futura. **Resuelto.**
7. Unificar invitación y verificación de administradores/recepcionistas.
8. Añadir pruebas de recorrido móvil y corregir la prueba web desactualizada.

Solo después de estabilizar esos puntos conviene introducir owner multi-gimnasio o modos simplificado/full, porque ambos ampliarían el número de transiciones y harían más costosas estas correcciones.

## Verificaciones ejecutadas

- Backend: 14 suites y 115 pruebas aprobadas.
- Backend: compilación aprobada.
- Móvil: `typecheck` aprobado.
- Superadmin web: compilación aprobada.
- Superadmin web: compilación y 3 pruebas aprobadas.
