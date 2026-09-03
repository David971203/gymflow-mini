# GymFlow Mini

MVP independiente para probar la digitalización de gimnasios cubanos con el menor alcance que permite medir valor real: **miembros, planes, membresías y finanzas**.

No comparte API, base de datos, tokens ni despliegue con GymFlow completo.

## Productos

| Carpeta | Usuario | Plataforma | Funciones |
|---|---|---|---|
| `mobile/` | `ADMIN`, `RECEPTIONIST` | Android (Expo) | Dashboard, miembros, planes, asignación de membresías, deuda y abonos. |
| `superadmin-web/` | `SUPER_ADMIN` | Web | Alta/activación de gimnasios y métricas consolidadas del piloto. |
| `backend/` | Ambos | NestJS REST | Autenticación, multi-tenancy, reglas de negocio y PostgreSQL. |

Panel demostrativo publicado, con acceso privado del propietario: <https://gymflow-mini-cuba.david9712.chatgpt.site>

Panel web publicado en Vercel: <https://superadmin-web-eight.vercel.app>

## Alcance deliberado del piloto

Incluye:

- Autorregistro del dueño desde Android con creación de su gimnasio y cuenta administrativa.
- Verificación obligatoria del correo en producción mediante código de 6 dígitos; desarrollo puede omitirla mediante configuración del backend.
- Prueba gratuita automática de 7 días, única por teléfono móvil y dispositivo Android.
- Solicitudes de planes mensual y anual con código P2P, contacto por WhatsApp y aprobación desde el panel.
- Recuperación de contraseña mediante código de 6 dígitos enviado por Gmail y cambio seguro desde Cuenta.

- Registro y edición básica de miembros con carnet de identidad cubano (CI) obligatorio.
- Varias cuentas por gimnasio, con perfiles fijos de administrador y recepcionista.
- Catálogo de planes con precio y duración en días.
- Una membresía activa y una renovación programada como máximo por miembro.
- Vencimiento calculado desde la duración del plan.
- Cobro creado automáticamente al adquirir o renovar un plan.
- Pagos pendientes, parciales, vencidos y pagados.
- Abonos sin sobrepago y ledger de movimientos reales.
- Indicadores de miembros, membresías activas, ingresos cobrados y deuda.
- Separación estricta entre gimnasios.

No incluye en esta prueba: miembros con cuenta propia, entrenadores, rutinas, clases ni reservas.

## Roles

- `SUPER_ADMIN`: no pertenece a un gimnasio. Solo entra al panel web, ve la plataforma completa y es el único que puede crear o retirar cuentas `ADMIN`.
- `ADMIN`: pertenece obligatoriamente a un gimnasio activo. Gestiona configuración, planes, suscripción y cuentas de recepcionistas, además de la operación diaria. Para solicitar otro administrador contacta con soporte desde la app.
- `RECEPTIONIST`: pertenece a un gimnasio y entra a la misma app Android. Gestiona miembros, membresías, cobros y asistencia; no puede modificar planes, suscripción ni cuentas.

Ambos clientes rechazan el rol equivocado y el backend mantiene la autorización efectiva.

## Modelo

```text
Gym 1--N User(ADMIN|RECEPTIONIST)
Gym 1--N Member
Gym 1--N Plan
Member 1--N Membership N--1 Plan
Membership 1--1 Payment 1--N PaymentMovement
User(ADMIN) 1--N PaymentMovement
Gym 1--N SyncReceipt N--1 User(ADMIN)
```

`Payment.amount` es el total a cobrar, `paidAmount` es lo aplicado y el saldo es la diferencia. Los ingresos se calculan desde `PaymentMovement`, no desde promesas de pago.

## Motor offline de Android

La app Android es **local-first**. Después de un primer login con conexión, el administrador puede consultar y modificar miembros, planes, membresías y cobros sin Internet durante un máximo de **72 horas desde la última validación online**. Al vencer ese plazo se bloquean las acciones hasta recuperar conexión y verificar la membresía. La sesión cifrada puede conservarse en SecureStore hasta 14 días para recuperar la cuenta y sus datos locales, pero ese plazo no amplía el permiso de operar offline.

### Flujo de datos

```text
Pantalla Android
  -> escritura optimista en SQLite (local_cache)
  -> operación persistente en SQLite (sync_outbox)
  -> POST /api/sync/push al recuperar conexión
  -> transacción/reglas de negocio en PostgreSQL
  -> recibo idempotente (SyncReceipt)
  -> GET /api/sync/snapshot
  -> reemplazo de la caché local por el estado canónico
```

- `local_cache` guarda los snapshots de miembros, planes y pagos por `gymId`.
- `sync_outbox` es una cola durable con estados `PENDING` y `REJECTED`. Cerrar la app o reiniciar el teléfono no pierde operaciones.
- Cada creación genera UUID locales; cada mutación lleva un UUID idempotente. Reenviar el mismo lote no crea otra membresía ni duplica un movimiento financiero.
- La sincronización ocurre al iniciar, volver la app al primer plano, recuperar red, arrastrar para refrescar o tocar la barra de estado.
- Los lotes se envían en orden, de 100 operaciones, hasta vaciar la cola. Después se descarga un snapshot completo; para el volumen del piloto es más simple y verificable que un cursor incremental.
- Mientras hay una sincronización activa, una nueva escritura local espera a que termine. Así el snapshot no puede pisar una acción recién realizada.
- Un rechazo afecta solo a su operación. La barra muestra una bandeja de incidencias que permite leer el motivo y descartar el aviso; el resto continúa sincronizando.

### Conflictos y CI duplicado

El cliente impide repetir un CI ya presente en el dispositivo y PostgreSQL aplica además `UNIQUE(gymId, ci)`, que es la autoridad final. Si dos teléfonos registran offline a la misma persona:

1. el primer alta aceptada crea al miembro;
2. la segunda se marca `MERGED`, no como un segundo miembro;
3. el identificador temporal se remapea al miembro canónico;
4. operaciones posteriores del mismo teléfono —por ejemplo asignarle un plan— se reescriben con el identificador correcto;
5. el snapshot elimina el duplicado optimista de la vista local.

Los planes creados simultáneamente con el mismo nombre siguen la misma estrategia. Las actualizaciones son operaciones de asignación de estado y las finanzas usan `clientMutationId` único tanto en la membresía como en cada movimiento, porque un cobro nunca puede aplicarse dos veces.

### Estado y límites conscientes

- `SYNCED`: el snapshot local coincide con el servidor.
- `SYNCING`: se está enviando la cola o descargando datos.
- `OFFLINE`: la app sigue operativa y conserva cambios pendientes.
- `ERROR`: la sesión debe validarse de nuevo online.
- Los datos de negocio están en la base SQLite privada de la app; el token y la sesión se guardan en SecureStore. Desinstalar la app borra la copia local, por lo que conviene sincronizar antes.
- El servidor siempre es la fuente canónica. El aislamiento por gimnasio nunca depende del `gymId` local: se obtiene del JWT.

Archivos principales: `mobile/src/offline.ts` (repositorio local, cola y orquestación), `mobile/src/api.ts` (sesión y transporte), `backend/src/sync.service.ts` (aplicación idempotente y conflictos), `backend/src/mini.service.ts` (reglas del negocio), y `backend/prisma/schema.prisma` (modelo persistente).

## Arquitectura y patrones

- **Backend modular:** controladores HTTP delgados, DTOs validados, servicios de aplicación y Prisma como acceso a datos.
- **Multi-tenant por contexto autenticado:** todas las consultas de ADMIN se acotan al gimnasio del JWT; SUPER_ADMIN usa rutas separadas.
- **Local-first + outbox:** la UI lee/escribe localmente y el transporte eventual no forma parte de la acción del usuario.
- **Idempotent consumer:** `SyncReceipt`, `Membership.clientMutationId` y `PaymentMovement.clientMutationId` hacen seguros los reintentos tras cortes ambiguos.
- **Optimistic UI con reconciliación:** la acción aparece inmediatamente; el snapshot posterior reconcilia con restricciones y cálculos del servidor.
- **Ledger financiero:** los movimientos son eventos inmutables; el saldo acumulado vive en `Payment` para consultas rápidas y se actualiza en la misma transacción.
- **Separación de productos:** móvil ADMIN, web SUPER_ADMIN, API y PostgreSQL son componentes independientes del GymFlow principal.

Endpoints del motor: `POST /api/sync/push` acepta hasta 100 operaciones ordenadas y `GET /api/sync/snapshot` devuelve dashboard, miembros, planes y pagos del gimnasio autenticado. Ambos requieren rol `ADMIN`.

## Inicio local

### 1. API y base de datos

```bash
copy .env.example .env
docker compose up -d --build
docker compose exec backend npm run prisma:seed
```

API: `http://localhost:3100/api`  
Swagger: `http://localhost:3100/api/docs`

### Despliegue del backend en Vercel

Al importar el repositorio en Vercel configura `backend` como **Root Directory**. Vercel detecta automáticamente `src/main.ts` como entrada NestJS. El `postinstall` del backend ejecuta `prisma generate` en cada instalación para que la caché de dependencias de Vercel no deje un Prisma Client desactualizado.

Variables necesarias en Production y Preview:

- `DATABASE_URL`: PostgreSQL accesible desde Internet y preferiblemente con pool de conexiones.
- `JWT_SECRET`: secreto largo y diferente al valor de ejemplo.
- `CORS_ORIGIN`: origen público del panel web; durante una prueba controlada puede ser `*`.

Antes del primer despliegue aplica las migraciones contra la base de producción desde un entorno seguro:

```bash
cd backend
DATABASE_URL="postgresql://..." npm run prisma:deploy
```

No ejecutes `prisma migrate dev` ni el seed automáticamente en cada build de producción.

### Despliegue del backend en Railway

Configura `backend` como **Root Directory** y deja que Railway use su `Dockerfile`. La imagen copia `prisma/` antes de `npm ci`, porque el `postinstall` necesita el esquema para generar Prisma Client. Al arrancar, el contenedor ejecuta `prisma migrate deploy` antes de iniciar NestJS.

Variables requeridas: `DATABASE_URL`, `JWT_SECRET` y `CORS_ORIGIN`. Railway proporciona `PORT` automáticamente; NestJS ya escucha ese valor en `0.0.0.0`.

Para la recuperación de contraseñas configura además `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM`. `SMTP_PASSWORD` debe ser una contraseña de aplicación de Google, no la contraseña normal del correo.

Si PostgreSQL está en Supabase, no uses en Railway la conexión directa
`db.<project-ref>.supabase.co:5432`: normalmente solo publica IPv6. En el panel de
Supabase abre **Connect**, selecciona **Session pooler** y copia esa cadena completa
como `DATABASE_URL`. El formato esperado es:

```text
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

El host, la región y el usuario del pooler deben copiarse del panel; no basta con
cambiar el host de la URL directa. El modo sesión (puerto `5432`) admite IPv4 y
funciona tanto para `prisma migrate deploy` como para el backend persistente.

### Entornos de producción y desarrollo en Render

- `main` alimenta el backend actual de producción: `https://gymflow-mini-backend.onrender.com`.
- `desarrollo` alimenta `gymflow-mini-backend-dev` y su PostgreSQL independiente `gymflow-mini-db-dev`.
- `render.yaml` define únicamente los recursos de desarrollo. Cada push a `desarrollo` despliega automáticamente el backend dev.
- El contenedor aplica las migraciones antes de arrancar. En desarrollo, `SEED_DATABASE=true` mantiene disponibles los datos demo mediante un seed idempotente; producción no define esa variable.
- La base gratuita de Render caduca 30 días después de crearla. Para conservar los datos de desarrollo hay que cambiarla a un plan de pago antes de esa fecha.

Flujo recomendado para una funcionalidad nueva:

```bash
git switch desarrollo
git pull origin desarrollo
# trabajar, validar y publicar en desarrollo
git push origin desarrollo
# cuando esté aprobada, integrar desarrollo en main para producción
```

Los builds `preview` e `ios-simulator` de Expo usan el backend de desarrollo. El perfil `production` conserva siempre la URL del backend productivo.

### 2. Aplicación móvil (Android e iOS)

```bash
cd mobile
copy .env.example .env
npm install
npm run start
```

En el emulador Android, el valor por defecto `http://10.0.2.2:3100` alcanza la computadora. En un teléfono físico configura `EXPO_PUBLIC_API_URL` con la IP LAN de la computadora.

Para generar un APK instalable mediante EAS: `npx eas build --platform android --profile preview`. El perfil ya está definido en `mobile/eas.json`.

#### Acceso con Google

El botón **Continuar con Google** sirve únicamente para entrar a una cuenta de administrador ya creada. Nunca registra usuarios ni crea gimnasios. Para habilitarlo:

1. En Google Cloud configura la pantalla de consentimiento OAuth.
2. Crea un cliente OAuth de tipo **Aplicación web**. Guarda su ID como `GOOGLE_AUTH_CLIENT_ID` en el backend y como `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` en la aplicación; ambos valores deben ser idénticos.
3. Crea un cliente OAuth de tipo **Android** para el paquete `com.gymflow.mini.admin` y registra las huellas SHA-1 de cada certificado usado para firmar la app (desarrollo, EAS y posteriormente Google Play).
4. Crea un cliente OAuth de tipo **iOS** para el bundle `com.gymflow.mini.admin` y guarda su ID como `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. `app.config.js` genera automáticamente el URL scheme requerido por iOS.
5. Configura las tres variables tanto en desarrollo como en producción y genera una compilación nueva. El inicio con Google utiliza código nativo y no funciona en Expo Go.

Los ID de cliente OAuth son configuración pública, no secretos. El backend valida el token de Google, su firma, audiencia, vencimiento y correo confirmado. Solo se admiten direcciones Gmail o Google Workspace, porque en esos casos Google controla autoritativamente el correo.

La versión iOS usa el bundle `com.gymflow.mini.admin`. Perfiles disponibles:

```bash
# Build para iOS Simulator (no necesita credenciales de Apple)
npx eas build --platform ios --profile ios-simulator

# Instalación interna en iPhone registrado
npx eas build --platform ios --profile preview

# Build para TestFlight/App Store
npx eas build --platform ios --profile production
```

`npm run ios` ejecuta el proyecto nativo localmente y requiere macOS con Xcode. Desde Windows se puede solicitar el build en EAS, pero el archivo del simulador debe ejecutarse posteriormente en un Mac.

### 3. Panel web

```bash
cd superadmin-web
npm install
$env:NEXT_PUBLIC_API_URL="http://localhost:3100"
npm run dev
```

El panel tiene un modo demostración para presentar el producto sin conectar una API. Toda escritura real requiere el backend.

## Credenciales demo

| Cliente | Correo | Contraseña |
|---|---|---|
| Panel web | `super@gymflowmini.cu` | `SuperMini123!` |
| App Android | `admin@habanafitness.cu` | `AdminMini123!` |

Solo para desarrollo; cambiarlas antes de una prueba real.

## Reglas heredadas de GymFlow

- El tenant proviene del JWT y nunca de un `gymId` enviado por la app.
- El CI contiene exactamente 11 dígitos y es único dentro de cada gimnasio. La restricción vive en PostgreSQL para impedir duplicados incluso cuando dos dispositivos sincronizan el mismo CI.
- No se asignan planes ni miembros de otro gimnasio.
- Una membresía futura queda `SCHEDULED`; una actual queda `ACTIVE`.
- No se permite más de una membresía activa vigente ni más de una programada.
- Adquirir/renovar siempre crea el cobro correspondiente.
- Un abono puede ser parcial, no puede superar el saldo y se registra como movimiento inmutable.
- Solo los movimientos de dinero cuentan como ingreso.
- Desactivar un gimnasio impide que su administrador inicie sesión.

## Cómo validar el nicho

Prueba durante 4 a 6 semanas con 3 a 5 gimnasios y registra semanalmente:

- Tiempo necesario para registrar un miembro y cobrarle.
- Porcentaje de miembros registrados respecto al libro o lista actual.
- Porcentaje de cobros anotados el mismo día.
- Deuda detectada que antes no estaba claramente registrada.
- Renovaciones realizadas a tiempo.
- Usuarios activos por gimnasio y días de uso por semana.
- Incidencias causadas por conectividad o por dificultad de uso.
- Disposición del dueño a pagar y rango de precio aceptable.

La señal más importante no es cuántas funciones piden, sino si el administrador continúa usando miembros y caja después de la primera semana.

## Comprobaciones

```bash
cd backend
npm run prisma:generate
npm test
npm run build

cd ../mobile
npm run typecheck

cd ../superadmin-web
npm run build
```

## Próximas decisiones después del piloto

Solo añadir una función si varias pruebas reales muestran el mismo problema. Candidatas: recordatorios de deuda, exportación a Excel/PDF, cierre diario de caja y asistencia simple. No migrar aún rutinas o clases del GymFlow completo.
