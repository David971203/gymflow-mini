# Arquitectura de la aplicación móvil

Este documento describe cómo quedó estructurado GymFlow Mini después de separar el antiguo `mobile/App.tsx` en módulos independientes. El objetivo de esta organización es que cada área pueda mantenerse, probarse y evolucionar sin concentrar toda la lógica en un único archivo.

## Estructura general del proyecto

```text
gymflow-mini/
├── backend/             API y lógica del servidor
├── landing-page/        Página pública del producto
├── mobile/              Aplicación móvil Expo/React Native
├── superadmin-web/      Panel web del superadministrador
├── work/                Recursos y archivos auxiliares
├── docker-compose.yml   Servicios locales
├── render.yaml          Configuración de despliegue
└── documentación        Auditorías, contexto y propuestas futuras
```

La documentación de la raíz también incluye las auditorías de los flujos actuales, el contexto de desarrollo y la propuesta futura para propietarios, múltiples gimnasios, roles y nuevos planes de suscripción.

## Estructura de la aplicación móvil

```text
mobile/
├── App.tsx
├── app.json
├── app.config.js
├── eas.json
├── assets/
└── src/
    ├── components/
    ├── core/
    ├── data/
    ├── features/
    ├── theme/
    ├── utils/
    ├── api.ts
    ├── offline.ts
    ├── notifications.ts
    ├── trustedClock.ts
    ├── membershipDates.ts
    ├── statistics.ts
    ├── types.ts
    └── AttendanceScreen.tsx
```

## Punto de entrada

### `mobile/App.tsx`

`App.tsx` quedó reducido a 56 líneas y funciona solamente como punto de entrada de la aplicación.

Sus responsabilidades son:

- Restaurar la sesión guardada.
- Cargar la preferencia de tema.
- Determinar si debe mostrarse el onboarding.
- Mostrar el inicio de sesión o registro.
- Mostrar la selección inicial de suscripción.
- Montar la aplicación administrativa.
- Cerrar la sesión si el servidor invalida las credenciales.
- Renderizar el sistema global de avisos.

El flujo principal es:

```text
Abre la aplicación
        ↓
Restaura configuración y sesión
        ↓
¿Completó el onboarding?
    ├── No → Pantallas de bienvenida
    └── Sí
         ↓
    ¿Está autenticado?
         ├── No → Inicio de sesión o registro
         └── Sí
              ↓
         ¿Tiene un plan?
              ├── No → Selección de suscripción
              └── Sí → Panel principal
```

## Funcionalidades (`src/features`)

Cada carpeta representa un área funcional de la aplicación.

### Contenedor y navegación (`features/shell`)

#### `AdminApp.tsx`

Es el contenedor que se monta después de iniciar sesión y tener una suscripción seleccionada.

Gestiona:

- Navegación inferior.
- Encabezado de cada pantalla.
- Usuario y gimnasio activos.
- Permisos de administrador y recepcionista.
- Estado y restricciones de la suscripción.
- Inicialización del almacenamiento offline.
- Sincronización con el servidor.
- Notificaciones de membresías y suscripción.
- Botón Atrás de Android.
- Apertura de pantallas desde notificaciones.
- Conexión entre Inicio, Miembros, Asistencia, Planes, Caja, Datos, Personal y Cuenta.

### Autenticación (`features/auth`)

#### `AuthScreen.tsx`

Contiene:

- Inicio de sesión.
- Registro inicial del administrador.
- Validaciones de los formularios.
- Selección de provincia y municipio.
- Autenticación con Google, cuando está habilitada.
- Presentación de errores de autenticación.

### Bienvenida (`features/onboarding`)

#### `OnboardingScreen.tsx`

Contiene las pantallas que aparecen durante la primera instalación:

- Presentación de GymFlow Mini.
- Resumen de las funciones principales.
- Explicación del control y organización del gimnasio.
- Acciones para continuar o saltar la presentación.

### Suscripción inicial (`features/subscriptions`)

#### `SubscriptionGate.tsx`

Controla el flujo de una cuenta que todavía no tiene un plan:

- Selección de plan mensual o anual.
- Generación de la solicitud de suscripción.
- Estados pendiente, aprobado y rechazado.
- Contacto mediante WhatsApp.
- Comprobación de la activación.
- Cierre de sesión.

### Cuenta (`features/account`)

#### `AccountScreen.tsx`

Gestiona la pestaña Cuenta:

- Datos del usuario autenticado.
- Datos del gimnasio.
- Estado y vencimiento de la suscripción.
- Renovaciones y cambios de plan.
- Solicitudes de suscripción pendientes.
- Cambio de contraseña.
- Tema claro, oscuro o del sistema.
- Soporte mediante WhatsApp.
- Cierre de sesión.
- Acceso a Personal cuando la función está habilitada.

### Personal (`features/staff`)

#### `StaffManager.tsx`

Gestiona las cuentas de trabajadores:

- Lista de recepcionistas.
- Lista de administradores.
- Sección futura de entrenadores.
- Creación y edición de recepcionistas.
- Activación o desactivación de cuentas.
- Eliminación de cuentas, conservando el historial cuando corresponde.
- Solicitud de otro administrador mediante soporte.
- Restricciones cuando la suscripción está vencida.

Actualmente esta funcionalidad continúa oculta mediante configuración.

### Miembros (`features/members`)

Esta sección está dividida en varios archivos porque reúne múltiples flujos relacionados.

#### `MembersScreen.tsx`

Coordina la funcionalidad completa de miembros:

- Carga miembros y planes.
- Abre y cierra formularios.
- Controla el miembro seleccionado.
- Archiva miembros.
- Asigna, renueva o programa membresías.
- Solicita sincronización.

#### `MembersList.tsx`

Presenta la lista de miembros:

- Búsqueda por nombre, código, CI o teléfono.
- Filtros de activos, inactivos, vencidos y próximos a vencer.
- Actualización manual.
- Acceso al registro de un miembro.
- Resumen de la membresía en cada fila.

#### `MemberForm.tsx`

Formulario utilizado para:

- Registrar miembros.
- Editar sus datos personales.
- Validar la información introducida.
- Añadir una membresía durante el registro.

#### `MemberActionsContent.tsx`

Presenta las acciones disponibles para un miembro seleccionado:

- Editar datos.
- Asignar una membresía.
- Cancelar la membresía activa.
- Renovar la membresía.
- Modificar una renovación programada.
- Archivar al miembro.

#### `MembershipForms.tsx`

Agrupa los formularios relacionados con membresías:

- Asignación inicial.
- Renovación.
- Renovación programada.
- Edición del periodo programado.

#### `MembershipPurchaseControls.tsx`

Contiene controles compartidos por los formularios de membresía:

- Elección del plan.
- Importe.
- Estado del pago.
- Cantidad abonada.
- Validaciones financieras.

#### `MemberPhotoAvatar.tsx`

Gestiona la presentación de la foto del miembro:

- Avatar con fotografía.
- Imagen predeterminada.
- Diferentes tamaños de presentación.
- Compatibilidad con tema claro y oscuro.

### Planes (`features/plans`)

#### `PlansScreen.tsx`

Gestiona los planes ofrecidos por el gimnasio:

- Listado de planes.
- Creación.
- Edición.
- Eliminación.
- Precio y duración.
- Restricciones para recepcionistas.
- Operaciones offline y sincronización.

### Caja y cobros (`features/payments`)

#### `PaymentsScreen.tsx`

Gestiona:

- Historial de cobros.
- Filtros y búsqueda.
- Cobros completos y parciales.
- Deudas pendientes.
- Detalles de cada operación.
- Registro de abonos.
- Exportación de información.
- Sincronización offline.

### Inicio y estadísticas (`features/analytics`)

#### `AnalyticsScreens.tsx`

Contiene:

- Panel de inicio.
- Resumen de miembros.
- Ingresos.
- Membresías próximas a vencer.
- Acceso rápido a asistencia.
- Pantalla de estadísticas.
- Comparaciones por periodos.

### Sincronización (`features/sync`)

#### `SyncStatus.tsx`

Presenta el estado de sincronización:

- Datos sincronizados.
- Sincronización en curso.
- Modo sin conexión.
- Cambios pendientes.
- Cambios rechazados.
- Detalles de los errores.
- Posibilidad de descartar avisos.

## Componentes compartidos (`src/components`)

### `BottomSheet.tsx`

Ventana inferior reutilizable para formularios, detalles y acciones:

- Animación de apertura y cierre.
- Adaptación al teclado.
- Área desplazable.
- Pie de formulario.
- Tema claro y oscuro.
- Espacio para avisos sobre el modal.

También contiene el campo de formulario reutilizable.

### `LoadingSkeleton.tsx`

Muestra filas animadas mientras una pantalla carga sus datos.

### `Toast.tsx`

Sistema global de mensajes:

- Éxito.
- Error.
- Solicitud pendiente.
- Solicitud rechazada.
- Priorización de mensajes cuando existen modales.
- Cierre automático.

## Infraestructura y lógica compartida

### `src/api.ts`

Es la puerta de entrada al backend:

- Autenticación.
- Restauración de sesión.
- Perfil.
- Suscripciones.
- Personal.
- Cambio de contraseña.
- Manejo de tokens.
- Detección de sesiones no autorizadas.

### `src/offline.ts`

Es el sistema de datos locales y sincronización:

- Guarda operaciones localmente.
- Lee miembros, planes y pagos.
- Mantiene la cola de mutaciones.
- Sincroniza con el servidor.
- Reintenta operaciones.
- Detecta cambios rechazados.
- Mantiene la aplicación utilizable sin conexión.

Aunque es un archivo grande, tiene una responsabilidad técnica concreta. En una fase futura podría dividirse en almacenamiento, repositorios y motor de sincronización.

### `src/notifications.ts`

Gestiona las notificaciones locales:

- Membresías próximas a vencer.
- Membresías vencidas.
- Vencimiento de la suscripción de la aplicación.
- Programación y cancelación de notificaciones.
- Apertura de una pantalla concreta desde una notificación.

### `src/trustedClock.ts`

Protege la validación offline de la suscripción:

- Mantiene una hora confiable.
- Detecta retrocesos sospechosos del reloj del dispositivo.
- Decide cuánto tiempo puede funcionar la aplicación sin conectarse.
- Solicita validación con el servidor cuando es necesario.

### `src/membershipDates.ts`

Centraliza los cálculos de fechas:

- Inicio y fin del día de membresía.
- Días restantes.
- Membresías vencidas.
- Vencimiento durante el día actual.
- Comparaciones consistentes de fechas.

### `src/statistics.ts`

Realiza cálculos estadísticos:

- Ingresos.
- Cantidades de miembros.
- Tendencias.
- Distribuciones.
- Resúmenes por periodo.

### `src/types.ts`

Contiene los tipos compartidos por la aplicación:

- Usuario.
- Gimnasio.
- Miembro.
- Membresía.
- Plan.
- Pago.
- Personal.
- Suscripción.
- Estado de sincronización.
- Pestañas.

### `src/AttendanceScreen.tsx`

Contiene la pantalla de asistencia y sus operaciones de entrada y salida. Su lógica ya está separada de `App.tsx`, aunque puede trasladarse posteriormente a `features/attendance` para mantener la misma convención del resto de pantallas.

## Configuración, datos y utilidades

### `src/core/config.ts`

Configuración central de la aplicación:

- Versión.
- Número de soporte.
- Intervalos de actualización.
- Claves de almacenamiento.
- Funciones experimentales.
- Mensajes de renovación.

### `src/data/cubaLocations.ts`

Listado de provincias y municipios utilizado durante el registro.

### `src/theme/colors.ts`

Define las paletas de colores clara y oscura.

### `src/theme/appStyles.ts`

Contiene los estilos visuales compartidos. Sigue siendo relativamente grande porque conserva los estilos históricos de varias pantallas, pero ya está separado de la lógica de negocio.

### `src/utils/domainFormatters.ts`

Funciones de presentación:

- Formato de dinero.
- Formato de fechas.
- Etiquetas de sexo.
- Estados de membresía.
- Nombre del plan contratado.
- Textos de días restantes.

### `src/utils/membershipSelectors.ts`

Funciones para localizar dentro de un miembro:

- Membresía activa.
- Membresía editable.
- Membresía programada.
- Membresía vencida.
- Próximo vencimiento.

## Recursos y configuración de compilación

### `mobile/assets`

Contiene los iconos utilizados por Android e iOS:

- `icon.png`
- `adaptive-icon.png`
- `ios-icon.png`

### `mobile/app.json` y `mobile/app.config.js`

Definen la identidad y configuración de Expo, incluyendo nombre, identificadores, iconos, variables y comportamiento por plataforma.

### `mobile/eas.json`

Define los perfiles utilizados para construir e instalar versiones de prueba o producción mediante EAS.

## Relación entre las capas

```text
App.tsx
   ↓
AdminApp
   ├── Inicio y estadísticas
   ├── Miembros
   ├── Asistencia
   ├── Planes
   ├── Caja
   ├── Personal
   └── Cuenta

Pantallas de funcionalidad
   ↓
Componentes reutilizables
   ↓
API / Datos offline / Notificaciones
   ↓
Backend
```

## Resultado de la reorganización

La mejora principal es que cada sección puede modificarse y probarse con menos riesgo de afectar las demás. `App.tsx` pasó de concentrar prácticamente toda la aplicación a encargarse únicamente del arranque y de decidir qué flujo principal debe mostrarse.

La división actual también prepara el proyecto para añadir nuevas funciones, roles y modos de operación sin volver a convertir el punto de entrada en un archivo monolítico.
