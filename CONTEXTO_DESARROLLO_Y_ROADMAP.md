# GymFlow Mini: contexto de desarrollo y roadmap

> Documento de continuidad para otra IA o desarrollador. Estado auditado el **3 de septiembre de 2026** sobre la rama `desarrollo`.

## 1. Resumen ejecutivo

GymFlow Mini es un MVP independiente para digitalizar la operación básica de gimnasios cubanos. Su hipótesis de producto es que un gimnasio pequeño obtiene valor inmediato al centralizar miembros, membresías, cobros, deuda y asistencia desde un teléfono, incluso con conectividad intermitente.

El sistema está compuesto por cuatro productos:

| Componente | Tecnología | Usuario principal | Estado |
|---|---|---|---|
| `mobile/` | Expo 54, React Native 0.81, TypeScript, SQLite | `ADMIN` y `RECEPTIONIST` | Producto operativo; Android/iOS configurados |
| `backend/` | NestJS 10, Prisma 5, PostgreSQL | Todos los clientes | API operativa, multi-tenant y probada |
| `superadmin-web/` | Next.js 16 / vinext | `SUPER_ADMIN` | Panel real más modo demostración |
| `landing-page/` | Next.js 16 estático | Visitantes y prospectos | Landing comercial terminada |

No comparte API, base de datos, sesiones ni despliegue con el GymFlow completo. El alcance actual sigue siendo un piloto: no hay cuentas para miembros, entrenadores, rutinas, clases o reservas.

## 2. Estado del repositorio

- Rama actual: `desarrollo`.
- Remoto: `https://github.com/David971203/gymflow-mini.git`.
- Último commit observado: `65ba6e9 feat: add receptionist staff accounts and permissions` (2026-09-02).
- El pie de Cuenta muestra “© 2026 GYMFLOW MINI · TODOS LOS DERECHOS RESERVADOS”.
- Producción usa `main`; desarrollo usa `desarrollo`.

Verificación realizada durante esta auditoría:

| Comprobación | Resultado |
|---|---|
| `backend`: `npm.cmd test -- --runInBand` | 10 suites y 87 pruebas aprobadas |
| `backend`: `npm.cmd run build` | Aprobado |
| `mobile`: `npm.cmd run typecheck` | Aprobado |
| `landing-page`: `npm.cmd run build` | Bloqueado por falta de acceso a Google Fonts (Geist) |
| `superadmin-web`: `npm.cmd run build:vercel` | Bloqueado por falta de acceso a Google Fonts (Geist/Geist Mono) |

Los fallos web observados son de red durante la descarga de fuentes mediante `next/font/google`, no una evidencia de fallo funcional del código. Para builds reproducibles sin Internet conviene autoalojar las fuentes con `next/font/local`.

## 3. Funcionalidades implementadas

### 3.1 Autenticación, alta y seguridad

- Inicio de sesión con correo y contraseña; contraseñas con Argon2 y JWT de 12 horas.
- Autorregistro de un dueño, creando gimnasio y cuenta `ADMIN`.
- Verificación de correo con código de seis dígitos, obligatoria en producción y configurable en desarrollo.
- Reenvío del código de verificación con control de intentos y caducidad.
- Recuperación y cambio de contraseña mediante código de seis dígitos; se guarda el hash, no el código en claro.
- Inicio con Google solo para cuentas administrativas ya existentes. Google no crea usuarios ni gimnasios.
- Cierre de sesiones anteriores mediante `tokenVersion` cuando cambia la contraseña o el estado de la cuenta.
- Validación global de DTOs con lista blanca y rechazo de campos no declarados, Helmet y control CORS.
- Separación estricta por gimnasio: el `gymId` efectivo proviene del JWT, nunca de la app móvil.

### 3.2 Suscripción de GymFlow Mini

- Prueba gratuita configurable, de siete días por defecto.
- Una sola prueba por número móvil verificado manualmente por WhatsApp y dispositivo Android mediante `TrialClaim`; la activación requiere aprobación del panel y las solicitudes tienen límites por teléfono, dispositivo e IP.
- Planes de plataforma `TRIAL`, `MONTHLY` y `ANNUAL`.
- Solicitudes de pago P2P para plan mensual o anual, con código único y contacto por WhatsApp.
- El superadministrador puede aprobar o rechazar solicitudes y activar/renovar/quitar suscripciones.
- Renovar el mismo plan y cambiar de anual a mensual se habilita durante los últimos 3 días. El nuevo período comienza el día posterior al vencimiento; si ya venció, comienza al aprobar. El cambio mensual a anual se aplica inmediatamente al aprobarlo.
- El backend permite lecturas cuando una suscripción venció, pero bloquea escrituras. Un gimnasio nuevo sin oferta elegida queda bloqueado hasta elegir prueba o plan.
- El móvil conserva operación offline un máximo de 72 horas desde la última validación confiable del servidor; SecureStore puede conservar la sesión hasta 14 días, sin ampliar ese permiso operativo.

### 3.3 Roles y permisos

- `SUPER_ADMIN`: cuenta global sin gimnasio. Opera solamente el panel web y administra gimnasios, suscripciones, solicitudes, administradores y datos operativos de cada tenant.
- `ADMIN`: administra su gimnasio, planes, miembros, membresías, caja, estadísticas, suscripción y cuentas de recepción.
- `RECEPTIONIST`: usa la misma app móvil para la operación diaria. Puede gestionar miembros, membresías, cobros y asistencia; no puede borrar miembros, modificar planes, ver Estadísticas, gestionar suscripción ni administrar cuentas.
- Un administrador puede crear, editar, activar/desactivar y eliminar cuentas `RECEPTIONIST`. Las cuentas `ADMIN` solo las gestiona el `SUPER_ADMIN`.
- Se protege al último administrador activo de un gimnasio.

### 3.4 Miembros

- Alta y edición con nombre, apellidos, CI, código interno, edad, sexo, teléfono, dirección y estado.
- CI cubano obligatorio de 11 dígitos y único por gimnasio; código interno opcional y también único por gimnasio.
- Búsqueda y filtros por activos, inactivos, vencidos y próximos a vencer.
- Alta guiada junto con el plan inicial, cantidad de períodos (máximo 24) y abono inicial opcional.
- Foto de perfil desde cámara o galería: recorte cuadrado, reducción previa, JPEG máximo de 250 KB, almacenamiento binario en PostgreSQL y caché autenticada local.
- Cada miembro recibe un `qrCode` global único.
- La eliminación preserva el historial cuando existe actividad: archiva el miembro y cancela sus membresías vigentes, pero conserva sin alterar los cobros, importes, saldos y abonos; solo borra físicamente cuando no hay historial financiero.

### 3.5 Planes y membresías

- Planes propios de cada gimnasio con nombre, descripción, precio, duración en días y estado activo/inactivo.
- Restricción de nombre único por gimnasio.
- Si un plan tiene historial se archiva en vez de destruirlo; no se elimina si sostiene una membresía activa.
- Asignación y renovación de membresías con uno o varios períodos.
- Snapshot inmutable de nombre, precio y duración del plan al contratar, para que cambios futuros no alteren el historial.
- Estados `SCHEDULED`, `ACTIVE`, `EXPIRED` y `CANCELLED`.
- La fecha de vencimiento es el primer día no válido según `America/Havana`: al comenzar ese día la membresía vence sin depender de la hora almacenada, y el miembro queda inactivo si no tiene otra membresía vigente.
- Máximo de una membresía vigente y una programada por miembro.
- Cancelar una membresía solo cancela el acceso: su cobro, importe, saldo y abonos permanecen positivos, visibles y contabilizados en Caja.
- Reconciliación automática de estados al iniciar el backend y cada medianoche.
- La lógica de renovaciones programadas existe en backend, sincronización y formularios móviles, pero su interfaz está oculta por `SHOW_SCHEDULED_MEMBERSHIP_UI = false`.

### 3.6 Caja, cobros y estadísticas

- Cada membresía crea automáticamente un cobro por el precio contratado multiplicado por la cantidad de períodos.
- Estados de cobro `PENDING`, `PARTIAL`, `OVERDUE`, `PAID` y `CANCELLED`.
- Abonos parciales por efectivo, transferencia u otro método; no se permite sobrepago.
- Un cobro creado en su fecha de vencimiento permanece pendiente durante todo ese día y solo pasa a vencido al comenzar el día siguiente, según `America/Havana`.
- Ledger inmutable en `PaymentMovement`; los ingresos reales se calculan desde movimientos, no desde importes prometidos.
- Caja con deuda total, cantidad pendiente, filtro por mes/año, detalle por miembro y movimientos.
- Exportación del conjunto filtrado a Excel `.xlsx`, con resumen y fórmulas, guardado en una carpeta elegida por el usuario.
- Estadísticas solo para `ADMIN`: crecimiento mensual, miembros activos/inactivos, membresías vigentes, desempeño por plan, ingresos, precio promedio, edades, sexos, mejores pagadores y miembros con deuda.
- Panel superadmin con facturación, cobrado, deuda, movimientos recientes, ingresos de suscripciones de la plataforma, gimnasios por tipo de plan y tendencia de miembros.

### 3.7 Asistencia y QR

- Modelo, API, sincronización offline y pantalla móvil implementados.
- Entrada manual o escaneando el QR del miembro; salida de una asistencia abierta.
- Solo se admite entrada a miembros activos con membresía vigente y no se permiten dos entradas abiertas.
- Métricas del día: entradas, personas dentro y salidas.
- El snapshot conserva entradas abiertas aunque sean anteriores al rango normal de consulta.
- Esta función **no está visible en navegación actualmente**: `SHOW_ATTENDANCE_ENTRY = false` y `ASISTENCIA` no forma parte del arreglo de pestañas. Debe considerarse implementada técnicamente, pero pendiente de activación/QA de producto.

### 3.8 Notificaciones y experiencia móvil

- Notificaciones locales de vencimiento tres días antes y el día del vencimiento.
- Se reprograman al sincronizar y llevan al miembro correspondiente al tocarlas.
- No funcionan en Expo Go; requieren build nativo y permiso del sistema.
- Interfaz optimista, estados de carga, mensajes de éxito/error, modo claro/oscuro interno y navegación adaptada al rol.
- El selector manual de tema existe, pero está oculto por `SHOW_THEME_SELECTOR = false`; actualmente se sigue el tema del sistema.

### 3.9 Panel web de superadministración

- Login real para `SUPER_ADMIN` y modo demo sin escrituras.
- Resumen general de plataforma y suscripciones.
- Bandeja de solicitudes P2P con aprobación/rechazo.
- Alta, edición, activación/desactivación y detalle de gimnasios.
- Gestión de administradores, planes, miembros, membresías, cobros y finanzas de cualquier gimnasio.
- La ruta `/gimnasios` reutiliza el mismo panel y estado que la portada del administrador.

### 3.10 Landing comercial

- Sitio responsive con propuesta de valor, funciones, precios, preguntas frecuentes y llamadas a descarga/contacto.
- Planes enlazados a mensajes de WhatsApp prellenados.
- Enlaces configurables para APK, Google Play, App Store, Instagram y Facebook.
- Exportación estática (`output: "export"`).

## 4. Arquitectura y flujo de datos

```text
Landing pública                   Panel SUPER_ADMIN
       |                                 |
       |                                 v
       |                         REST + JWT /api/platform
       |                                 |
       v                                 v
Prospecto ----> App Expo ----> API NestJS ----> PostgreSQL
                    |              |
                    |              +--> correo (Mailjet/Gmail API/Apps Script/SMTP)
                    |
                    +--> SecureStore: token/sesión
                    +--> SQLite local_cache: snapshot por gimnasio
                    +--> SQLite sync_outbox: operaciones pendientes/rechazadas
```

El móvil es local-first:

1. La interfaz escribe de forma optimista en SQLite.
2. Se añade una mutación con UUID a `sync_outbox`.
3. Al recuperar conexión, `POST /api/sync/push` envía lotes ordenados de hasta 100 operaciones.
4. El backend aplica reglas y transacciones; `SyncReceipt` evita repetir operaciones.
5. `GET /api/sync/snapshot` devuelve el estado canónico completo.
6. La caché local se reemplaza y reconcilia IDs/conflictos.

Operaciones offline soportadas: crear/editar/eliminar miembros y planes; asignar/editar/renovar/eliminar membresías; aplicar pagos; registrar entrada/salida. La subida de fotos y la edición de planes desde su formulario requieren Internet explícitamente.

Los conflictos de CI o nombre de plan duplicado se fusionan con el registro canónico y se remapean las referencias siguientes del lote. Los UUID en membresías, abonos y asistencias impiden duplicaciones después de cortes ambiguos.

## 5. Modelo de datos esencial

```text
Gym 1--N User (ADMIN | RECEPTIONIST)
Gym 1--N Member 1--0..1 MemberPhoto
Gym 1--N Plan
Member 1--N Membership N--1 Plan
Membership 1--1 Payment 1--N PaymentMovement
Member 1--N Attendance
Gym 1--N PlatformSubscription
Gym 1--N SubscriptionRequest
Gym 1--0..1 TrialClaim
Gym/User 1--N SyncReceipt
User 1--N PasswordResetCode / EmailVerificationCode
```

Fuente de verdad: `backend/prisma/schema.prisma`. Hay migraciones incrementales para offline, CI, perfiles, suscripciones de plataforma, autorregistro, recuperación, QR/asistencia, fotos, recepcionistas y verificación de correo.

## 6. API: superficies principales

- `/api/auth/*`: login, Google, registro, verificación, recuperación, perfil, cambio de contraseña y solicitud de suscripción.
- `/api/members`, `/api/plans`, `/api/memberships`, `/api/payments`: operación del gimnasio autenticado.
- `/api/members/:id/photo`: carga, consulta y eliminación de foto.
- `/api/staff`: gestión de recepcionistas por un administrador.
- `/api/attendance`: listado, entrada y salida.
- `/api/sync/push` y `/api/sync/snapshot`: motor local-first.
- `/api/platform/*`: superficie exclusiva de `SUPER_ADMIN`.
- `/api/health`: salud del servicio.
- `/api/docs`: Swagger.

No crear endpoints que acepten y confíen en un `gymId` enviado por un cliente de gimnasio. Las rutas `/platform/gyms/:gymId/*` son la excepción deliberada y están protegidas por rol `SUPER_ADMIN`.

## 7. Entornos, despliegue y configuración

### Producción

- Backend: `https://gymflow-mini-backend.onrender.com`.
- Rama: `main`.
- Panel publicado indicado en el README: `https://superadmin-web-eight.vercel.app`.
- Existe además un panel demostrativo privado publicado con Sites.

### Desarrollo

- Backend: `https://gymflow-mini-backend-dev.onrender.com`.
- Rama: `desarrollo`, autodesplegada por `render.yaml`.
- PostgreSQL independiente `gymflow-mini-db-dev` y seed idempotente con `SEED_DATABASE=true`.
- La base gratuita fue creada el 2 de septiembre de 2026 y se estima que caduca alrededor del 2 de octubre de 2026 si no se actualiza el plan.
- Render gratuito puede dormir el servicio y provocar un primer arranque de aproximadamente 50 segundos o más.

### Expo/EAS

- Paquete Android y bundle iOS: `com.gymflow.mini.admin`.
- Versión observada: `0.1.1`; Android `versionCode: 2`, iOS `buildNumber: 2`.
- `preview` genera APK interno; `production` genera Android App Bundle; existe perfil `ios-simulator`.
- En la configuración actual, preview, simulador iOS y producción apuntan al backend productivo. El `.env` móvil local apunta al backend de desarrollo.

### Variables importantes

- Backend: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `EMAIL_VERIFICATION_REQUIRED`, `GOOGLE_AUTH_CLIENT_ID`.
- Correo: elegir `MAIL_PROVIDER` y configurar Mailjet, Gmail API, Apps Script o SMTP con las variables documentadas en `backend/.env.example`.
- Móvil: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_RENEWAL_WHATSAPP`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
- Panel: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`.
- Landing: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APK_URL`, tiendas, WhatsApp y redes sociales.

Nunca copiar secretos reales a este documento ni confirmarlos en Git. Los IDs públicos OAuth sí pueden estar en la configuración del cliente; el secreto y tokens de correo no.

## 8. Reglas de negocio que no deben romperse

1. Toda consulta operativa debe quedar aislada por el gimnasio del JWT.
2. El CI tiene 11 dígitos y es único dentro del gimnasio.
3. No se cruzan miembros, planes, cobros ni asistencias entre gimnasios.
4. Una membresía conserva el snapshot del plan contratado.
5. No puede existir más de una membresía vigente ni más de una programada por miembro.
6. Contratar o renovar siempre crea su cobro en la misma operación lógica.
7. Un abono no supera el saldo y cada movimiento es inmutable e idempotente.
8. Solo `PaymentMovement` cuenta como ingreso cobrado.
9. Los registros con historial se archivan/cancelan; no se destruye trazabilidad financiera.
10. Una recepción hereda el acceso o bloqueo de suscripción de su gimnasio.
11. Las escrituras optimistas deben sobrevivir al cierre de la app y reconciliarse con el servidor.
12. La hora local del dispositivo no debe permitir extender fraudulentamente la operación offline.

## 9. Deuda técnica, riesgos y decisiones pendientes

- `mobile/App.tsx` concentra gran parte de la aplicación en un archivo muy grande. Conviene separar pantallas, formularios, tema, componentes y navegación antes de aumentar mucho el alcance.
- Asistencia, renovaciones programadas y selector de tema están implementados pero ocultos. No borrar ese código sin decidir si se activa o se retira.
- Las fotos requieren conexión y no forman parte de la outbox; la UI ya lo comunica.
- El snapshot de sincronización es completo. Es apropiado para el piloto, pero crecerá en costo con muchos miembros, fotos indirectas y asistencias.
- El scheduler de vencimientos vive dentro del proceso del backend. En infra serverless o con reinicios no sustituye un cron durable; las consultas también deben interpretar fechas correctamente.
- Las notificaciones son locales al dispositivo del administrador. No existe backend de push, preferencias por usuario ni entrega garantizada.
- El panel guarda el JWT en `localStorage`; antes de una exposición mayor debe evaluarse una sesión con cookie `HttpOnly`, CSRF y política de expiración/renovación.
- `CORS_ORIGIN=*` es cómodo para el piloto, pero debe cerrarse a orígenes conocidos en producción.
- Los builds web dependen de Google Fonts en tiempo de build. Autoalojarlas eliminaría el fallo por red observado.
- El README principal aún presenta asistencia y exportación como candidatas futuras, aunque ambas ya tienen implementación. Debe alinearse después de decidir qué funciones se exponen en la versión publicada.
- Faltan pruebas automatizadas propias del cliente móvil. Hay buena cobertura de reglas del backend, pero no E2E de flujos críticos ni prueba automatizada de sincronización real entre dos dispositivos.
- La página `/gimnasios` del panel solo reexporta el componente principal; funciona, pero no es aún una arquitectura de rutas separadas.
- Confirmar antes de cada build EAS qué backend usa cada perfil. El README y `ENTORNOS_RENDER.txt` deben mantenerse sincronizados con `mobile/eas.json`.

## 10. Funcionalidades futuras propuestas

Las siguientes funciones se declaran como roadmap, no como funcionalidad ya disponible. Deben priorizarse con evidencia del piloto y sin convertir prematuramente GymFlow Mini en el producto GymFlow completo.

### Fase 0 — estabilización para piloto real

1. **Activar y validar asistencia**: exponer la entrada desde navegación, probar cámara/QR en Android e iOS, operación offline, doble escaneo, salida y permisos denegados.
2. **Decidir renovaciones programadas**: completar QA y activar `SHOW_SCHEDULED_MEMBERSHIP_UI`, o retirar temporalmente la interfaz muerta conservando soporte de datos.
3. **Cierre diario de caja**: resumen por usuario y método, efectivo esperado, diferencias declaradas, hora de cierre y registro inmutable.
4. **Recordatorios accionables de deuda**: botón para preparar mensaje de WhatsApp, plantillas editables y registro de contacto; no enviar automáticamente sin consentimiento.
5. **Reporte PDF e impresión/compartir**: recibo de pago, estado de cuenta por miembro y cierre diario. Excel ya está implementado.
6. **Hardening de producción**: CORS restringido, cookies o estrategia segura para el panel, rotación de secretos, rate limiting en login/códigos y fuentes web locales.
7. **QA automatizado del móvil**: pruebas de repositorio SQLite/outbox, reloj confiable, cálculos estadísticos y flujos E2E de alta-cobro-sincronización.

### Fase 1 — operación y retención

1. **Auditoría operativa**: historial de quién creó/editó/canceló miembros, planes, membresías y cobros, con fecha y dispositivo.
2. **Copia y exportación de datos**: CSV/XLSX de miembros y movimientos, exportación administrativa por gimnasio y procedimiento de restauración.
3. **Notificaciones configurables**: preferencias por usuario y gimnasio, anticipación configurable y eventual push remoto para varios dispositivos.
4. **Dashboard de asistencia**: visitas por día/hora, frecuencia por miembro, ausencias y retención; filtros y exportación.
5. **Importación inicial**: plantilla Excel/CSV, previsualización, validación de CI/códigos y reporte de filas rechazadas.
6. **Mejoras de sincronización**: paginación o cursor incremental, compactación de recibos, telemetría de colas y recuperación guiada de rechazos.
7. **Distribución oficial**: privacidad, términos, soporte, pruebas internas y publicación gradual en Google Play; TestFlight/App Store si el piloto confirma demanda iOS.

### Fase 2 — crecimiento validado

1. **Portal/cuenta opcional del miembro**: QR propio, vigencia, pagos y recibos. Solo si los gimnasios demuestran necesidad recurrente.
2. **Planes y precios más flexibles**: promociones, descuentos auditables, congelación de membresía y reglas de prorrateo.
3. **Múltiples sedes**: únicamente si aparecen clientes reales con varias ubicaciones; requerirá ampliar el modelo de tenant, usuarios y asistencia.
4. **Integraciones de pago**: conciliación con proveedores disponibles en el mercado objetivo, sin marcar ingresos antes de confirmación.
5. **Analítica del piloto**: cohortes, renovación, morosidad recuperada, frecuencia de uso y salud por gimnasio.

### Fuera de alcance hasta nueva validación

- Entrenadores, rutinas, ejercicios y seguimiento deportivo.
- Clases, horarios y reservas.
- Marketplace, nutrición o red social.
- Migración o integración con GymFlow completo.

Estas áreas pueden multiplicar la complejidad sin validar primero que los gimnasios usan de forma sostenida miembros, caja, renovaciones y asistencia.

## 11. Orden recomendado para la siguiente IA

1. Leer este archivo, `README.md`, `ENTORNOS_RENDER.txt` y `backend/prisma/schema.prisma`.
2. Ejecutar `git -c safe.directory=C:/Users/David/Downloads/gymflow-fase8/gymflow-mini status --short` y preservar cambios ajenos.
3. Confirmar rama y entorno objetivo antes de editar o desplegar.
4. Para lógica de negocio, leer primero las pruebas correspondientes; añadir prueba de regresión antes o junto al cambio.
5. Mantener DTO, servicio, sincronización, tipos móviles y caché local alineados cuando cambie una entidad.
6. Probar siempre el caso offline, el reintento idempotente, el aislamiento entre gimnasios y los permisos `ADMIN`/`RECEPTIONIST`.
7. Validar con:

```powershell
cd backend
npm.cmd run prisma:generate
npm.cmd test -- --runInBand
npm.cmd run build

cd ../mobile
npm.cmd run typecheck

cd ../superadmin-web
npm.cmd run build:vercel

cd ../landing-page
npm.cmd run build
```

8. Si los builds web no tienen red, autoalojar Geist o ejecutar en un entorno que pueda alcanzar `fonts.googleapis.com`; no atribuir ese fallo automáticamente al código.
9. Actualizar este documento y el README cuando una función pase de oculta/propuesta a publicada.

## 12. Archivos clave

- `mobile/App.tsx`: composición de la app, autenticación, pantallas, caja, estadísticas, fotos, personal y flags de producto.
- `mobile/src/offline.ts`: SQLite, caché, outbox y sincronización.
- `mobile/src/api.ts`: transporte, token y perfil.
- `mobile/src/AttendanceScreen.tsx`: asistencia manual/QR.
- `mobile/src/notifications.ts`: avisos locales de vencimiento.
- `mobile/src/trustedClock.ts`: límite seguro de operación offline.
- `mobile/src/statistics.ts`: cálculos del panel de datos.
- `backend/src/auth.service.ts`: sesiones, registro, verificación, Google, recuperación y suscripción.
- `backend/src/mini.service.ts`: reglas principales de negocio y plataforma.
- `backend/src/sync.service.ts`: aplicación idempotente y resolución de conflictos.
- `backend/src/attendance.service.ts`: reglas de entrada/salida.
- `backend/src/guards.ts`: JWT, roles y acceso por suscripción.
- `backend/src/membership-expiration.service.ts`: reconciliación periódica.
- `backend/prisma/schema.prisma`: modelo canónico.
- `superadmin-web/app/page.tsx`: panel de plataforma y modo demo.
- `landing-page/app/page.tsx`: sitio comercial.
- `render.yaml`, `mobile/eas.json`, `.env.example`: infraestructura y configuración esperada.

## 13. Métricas de validación del producto

Durante cuatro a seis semanas con tres a cinco gimnasios, registrar:

- tiempo para dar alta y cobrar a un miembro;
- porcentaje de miembros migrados respecto al registro anterior;
- porcentaje de cobros anotados el mismo día;
- deuda detectada y posteriormente recuperada;
- renovaciones realizadas antes o poco después del vencimiento;
- días de uso semanal por gimnasio y por rol;
- entradas registradas frente a asistencia estimada;
- incidencias de conectividad, sincronización y comprensión de la interfaz;
- disposición a pagar y precio aceptable.

La señal principal es la retención operativa: que administración y recepción sigan usando miembros, caja y asistencia después de la primera semana. El roadmap debe responder a fricciones repetidas de usuarios reales, no solo a una lista amplia de funciones solicitadas.

### Personal y acceso: navegación móvil

- Entrada Personal y acceso dentro de Cuenta, exclusiva de administradores; abre una pantalla propia con regreso a Cuenta. No aparece en la barra de pestañas.
- Navegación interna por Recepción, Administración y Entrenadores. Recepción permite crear, editar, desactivar y eliminar cuentas con los permisos existentes; Administración conserva la solicitud por WhatsApp a soporte.
- Entrenadores muestra Próximamente: su sección de interfaz está reservada, pero no se ha creado un rol autenticable ni se han concedido permisos. Su incorporación requerirá modelo, API y permisos propios.
