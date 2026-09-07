# GymFlow Mini: propuesta de cuentas, planes y modos de operación

> Documento de producto y arquitectura. Estado: **propuesta para validar durante el piloto; no implementada**. Elaborado el 7 de septiembre de 2026.

## 1. Objetivo

Permitir que una misma persona use una sola cuenta para participar en varios gimnasios con responsabilidades diferentes, pueda ser propietaria de uno o varios gimnasios y contrate una suscripción acorde con la cantidad de gimnasios que posee.

Cada gimnasio podrá operar con una experiencia **Simple** o **Completa (Full)** sin crear dos aplicaciones ni dos bases de código independientes.

La propuesta separa cuatro conceptos que hoy están combinados:

1. La identidad de una persona.
2. Su rol y acceso en cada gimnasio.
3. La organización propietaria y su suscripción a GymFlow.
4. El modo de operación elegido para cada gimnasio.

## 2. Contraste con el modelo actual

Actualmente:

- El autorregistro solicita el nombre del gimnasio.
- En una misma transacción se crean el gimnasio y un usuario con rol `ADMIN`.
- El creador no queda diferenciado técnicamente como `OWNER`.
- `User.email` es único.
- Cada `User` tiene un solo `gymId` y un solo `role`.
- El `gymId` se incluye en el JWT y determina el tenant de todas las operaciones.
- La suscripción de plataforma pertenece al gimnasio y `MONTHLY`/`ANNUAL` funcionan como planes, en vez de ser periodos de facturación.

Como consecuencia, una persona no puede usar el mismo correo para ser propietaria de un gimnasio, administradora de otro y recepcionista o entrenadora de un tercero.

Modelo objetivo:

```text
Usuario: persona@correo.com
├── Gimnasio A → OWNER
├── Gimnasio B → ADMIN
└── Gimnasio C → TRAINER
```

Se conservaría una sola cuenta, contraseña, verificación de correo e identidad.

## 3. Modelo conceptual recomendado

```text
User
- id
- email (global y único)
- name
- phone
- passwordHash
- isActive
- emailVerifiedAt

Organization
- id
- name
- ownerUserId
- isActive

OrganizationMember
- organizationId
- userId
- role: OWNER | ORGANIZATION_ADMIN
- status: ACTIVE | SUSPENDED

Subscription
- organizationId
- tier: BASIC | PRO | ULTIMATE
- billingPeriod: MONTHLY | ANNUAL
- gymLimit
- agreedPrice
- status: PENDING | ACTIVE | PAST_DUE | READ_ONLY | SUSPENDED | CANCELLED
- startsAt
- endsAt
- scheduledTier
- scheduledBillingPeriod
- scheduledStartsAt

Gym
- id
- organizationId
- name
- operationMode: SIMPLE | FULL
- lifecycleStatus: ACTIVE | ARCHIVED
- isActive

GymUser
- gymId
- userId
- role: ADMIN | RECEPTIONIST | TRAINER
- status: INVITED | ACTIVE | SUSPENDED | REMOVED

Member
- id
- gymId
- userId (opcional; enlaza la ficha con una cuenta global)
- datos propios del miembro en ese gimnasio
- status

GymInvitation
- id
- gymId
- email
- role
- tokenHash
- status: PENDING | ACCEPTED | REJECTED | EXPIRED | CANCELLED
- expiresAt
```

El propietario obtiene acceso a sus gimnasios mediante la organización. Si esa misma persona trabaja en un gimnasio ajeno, su acceso laboral se representa de forma independiente en `GymUser`.

Si además es cliente de otro gimnasio, su ficha `Member` puede enlazarse opcionalmente con el mismo `User`. La cuenta global identifica a la persona, mientras que la ficha de miembro conserva los datos, membresías, cobros, asistencia y estado que pertenecen exclusivamente a ese gimnasio.

```text
Una sola cuenta
├── Gimnasio A → OWNER
├── Gimnasio B → ADMIN
├── Gimnasio C → TRAINER
└── Gimnasio D → MEMBER
```

Las relaciones son independientes. El rol o la condición de miembro en un gimnasio no concede permisos ni revela información de los otros.

No se debe convertir `OWNER` en un rol global: ser propietario de un gimnasio no convierte a la persona en propietaria de los demás gimnasios donde participa.

## 4. Alta de un nuevo propietario

Flujo recomendado:

```text
Crear cuenta personal
→ Verificar correo
→ Crear organización
→ Elegir plan y periodo
→ Pagar o solicitar activación
→ Añadir gimnasio(s)
→ Elegir el modo de cada gimnasio
→ Entrar a la operación
```

### 4.1 Datos solicitados antes de verificar

- Nombre de la persona.
- Correo.
- Teléfono.
- Contraseña.

El nombre y la ubicación del gimnasio se solicitan después de activar la suscripción. La cuenta verificada puede existir temporalmente sin gimnasio.

### 4.2 Usuario existente que desea convertirse en propietario

Una persona que ya es `ADMIN`, `RECEPTIONIST` o `TRAINER` en un gimnasio no crea otra cuenta. Desde su cuenta existente selecciona **Crear mi organización**, contrata un plan y crea su gimnasio.

Ejemplo:

```text
Cuenta existente
├── Gimnasio donde trabaja → ADMIN
└── Su gimnasio nuevo → OWNER
```

Solo paga la suscripción de su propia organización. El gimnasio donde trabaja depende de la suscripción de su propietario correspondiente.

## 5. Planes de suscripción

El plan determina la capacidad de la organización; el periodo determina cuánto dura cada cobro.

| Plan | Capacidad propuesta | Contratación |
|---|---:|---|
| `BASIC` | Hasta 1 gimnasio | Precio mensual o anual publicado |
| `PRO` | Hasta 4 gimnasios | Precio mensual o anual publicado |
| `ULTIMATE` | Límite personalizado | Cotización y activación manual |

`MONTHLY` y `ANNUAL` dejan de ser planes y pasan a ser valores de `billingPeriod`.

Ejemplo:

```text
Plan: PRO
Periodo: ANNUAL
Límite: 4 gimnasios
Uso actual: 3 de 4
```

Cuando se alcance el límite, la app no permite crear otro gimnasio y ofrece cambiar de plan.

### 5.1 Ultimate

Flujo:

```text
Solicitar Ultimate
→ Indicar cantidad de gimnasios y datos de contacto
→ Preparar cotización
→ Acordar precio, periodo y límite
→ Registrar/aprobar pago
→ Activar suscripción
```

La suscripción guarda el `gymLimit` y el precio acordado para ese cliente.

## 6. Modos de operación por gimnasio

El modo se configura en cada gimnasio, no en el usuario ni globalmente en la organización. Una organización puede tener simultáneamente gimnasios Simple y Full.

### 6.1 Modo Simple

Experiencia reducida para un propietario que administra personalmente:

- Fichas internas de miembros/clientes.
- Planes, membresías y cobros del gimnasio.
- Estadísticas básicas.
- Sin cuentas de miembros.
- Sin administradores adicionales, recepcionistas ni entrenadores operando en la app.
- Sin entrada, salida, asistencia o control de acceso.

### 6.2 Modo Full

Experiencia completa:

- Administradores.
- Recepcionistas.
- Entrenadores.
- Cuentas opcionales para miembros.
- Invitaciones y permisos por gimnasio.
- Entrada/salida, asistencia y QR.
- Operación realizada por varios usuarios.

### 6.3 Implementación de producto

Debe existir una sola aplicación con navegación y capacidades adaptadas a `Gym.operationMode`. No se recomienda mantener dos aplicaciones o bifurcar la lógica de negocio.

El modelo de datos interno debe estar preparado para Full aunque el gimnasio empiece en Simple. De ese modo puede crecer sin migrar ni duplicar su información.

### 6.4 Cambio de Full a Simple

Al pasar un gimnasio de `FULL` a `SIMPLE`:

- El `OWNER` conserva acceso.
- `ADMIN`, `RECEPTIONIST`, `TRAINER` y las cuentas de miembros pierden temporalmente el acceso a ese gimnasio.
- No se desactivan sus cuentas globales.
- No se eliminan relaciones, invitaciones aceptadas, permisos, historial ni configuración.
- Esos usuarios pueden continuar usando otros gimnasios donde tengan acceso.
- Al reactivar Full recuperan sus accesos anteriores, salvo que hayan sido suspendidos expresamente.

La regla de autorización sería conceptualmente:

```text
si gym.operationMode == SIMPLE:
    permitir operación solamente al OWNER
si gym.operationMode == FULL:
    aplicar el rol y estado correspondiente
```

Antes de desactivar Full, la app debe mostrar cuántas personas perderán acceso, pedir confirmación, requerir conexión y registrar el cambio en auditoría.

## 7. Trabajadores, cuentas e invitaciones

Hay que distinguir dos validaciones:

1. **Identidad:** la persona verifica una sola vez que controla su correo o teléfono.
2. **Acceso:** la persona acepta una invitación y un rol para un gimnasio concreto.

El owner o administrador autorizado escribe el correo y selecciona el rol. El backend busca internamente la cuenta, pero la interfaz no ofrece un directorio global ni revela en qué otros gimnasios trabaja esa persona.

### 7.1 Si la cuenta ya existe

Se crea una invitación pendiente. Al aceptarla se crea o activa la relación `GymUser` para ese gimnasio. La persona usa su misma cuenta y contraseña.

### 7.2 Si la cuenta no existe

La invitación queda asociada al correo. La persona crea su cuenta, verifica el correo y acepta la invitación.

Por privacidad, la respuesta al remitente debe ser equivalente exista o no la cuenta: **Enviaremos una invitación a este correo**. No se muestran roles ni relaciones externas.

### 7.3 Autoridad para asignar roles

- `OWNER`: se obtiene al crear la organización o mediante una transferencia formal de propiedad.
- `ADMIN`: solamente puede invitarlo o aprobarlo un `OWNER`.
- `RECEPTIONIST` y `TRAINER`: puede invitarlos un `OWNER` o un `ADMIN`, según la política final.
- Nadie puede concederse permisos en una organización ajena.
- Una cuenta existente debe aceptar la invitación; no se incorpora silenciosamente.

Los trabajadores no contratan la suscripción de la organización. El responsable de pago es el propietario.

## 8. Selección de gimnasio y aislamiento

Después de iniciar sesión, una persona con varios accesos selecciona el contexto:

```text
Mis gimnasios

Habana Fitness       OWNER
Gym Vedado           ADMIN
Gym Playa            RECEPTIONIST
Gym Cerro            MEMBER
```

Al seleccionar uno, el backend valida la relación y establece el `gymId` y los permisos efectivos de esa sesión. Puede emitirse un JWT de contexto o utilizarse otro mecanismo seguro equivalente.

Se mantiene la regla actual: el backend no confía en un `gymId` arbitrario enviado por el cliente. El gimnasio activo debe derivarse de una selección autorizada y firmada.

La caché local, la outbox y cualquier dato offline deben continuar separados por `gymId`. Cambiar de gimnasio requiere cargar el snapshot correspondiente y no mezclar operaciones pendientes.

## 9. Ciclo de vida de la suscripción

Pantalla propuesta para el owner:

```text
Plan actual: Pro
Facturación: Anual
Gimnasios: 3 de 4
Estado: Activo
Vence: 15 de septiembre de 2027

[Cambiar plan]
[Renovar]
[Historial de pagos]
```

Solo el owner o un administrador de organización expresamente autorizado puede gestionar la suscripción.

### 9.1 Renovar el mismo plan

- Si está activo, el nuevo periodo se añade después del vencimiento actual.
- Si ya venció, comienza cuando se aprueba el pago.
- Una renovación mensual añade un mes; una anual añade un año.
- El día de vencimiento continúa siendo utilizable completo según `America/Havana`, manteniendo la convención actual.

### 9.2 Cambio mensual a anual

Se programa para el próximo vencimiento. El mismo plan y límite permanecen activos hasta entonces. Esto evita devoluciones o créditos del periodo mensual en curso.

### 9.3 Cambio anual a mensual

Se programa para el final del periodo anual pagado. No se devuelve el tiempo restante.

### 9.4 Upgrade de Basic a Pro

El upgrade se activa después de aprobar el pago y aumenta inmediatamente el límite de uno a cuatro gimnasios.

Política recomendada para el piloto:

```text
importe del upgrade =
(precio del plan nuevo - precio del plan actual)
× proporción del periodo restante
```

Se conserva la fecha de vencimiento original. Para reducir complejidad durante el piloto, el superadministrador puede calcular o ajustar manualmente el importe de la solicitud.

### 9.5 Upgrade a Ultimate

Requiere cotización. Al aprobar el pago se actualizan inmediatamente el plan, el precio acordado y `gymLimit`. Debe quedar explícito si conserva el vencimiento actual con un cobro proporcional o inicia un periodo nuevo aplicando el saldo anterior como crédito.

### 9.6 Downgrade de Pro a Basic

El downgrade se programa para el próximo vencimiento y nunca borra datos.

Si existen varios gimnasios, el owner debe seleccionar cuál permanecerá activo. Los demás pasan a `ARCHIVED` o solo lectura al hacerse efectivo el downgrade. Sus datos y relaciones se conservan y pueden reactivarse tras un upgrade.

No se permite completar un downgrade mientras no se haya resuelto qué gimnasios quedarán dentro del nuevo límite.

### 9.7 Downgrade desde Ultimate

Se aplica al próximo vencimiento y requiere revisar el límite contratado. Si la cantidad de gimnasios excede el destino, se deben seleccionar los que continuarán activos o acordar otra cotización.

### 9.8 Cancelación o falta de pago

Secuencia sugerida:

```text
ACTIVE → PAST_DUE → READ_ONLY → SUSPENDED
```

- Al vencer, se bloquean las nuevas escrituras de acuerdo con la política de gracia definida.
- Durante el periodo de gracia se permite consultar y renovar.
- Los datos nunca se eliminan automáticamente por falta de pago.
- Al reactivarse la suscripción se recuperan gimnasios, usuarios, roles y configuración.

### 9.9 Regla resumida de cambios

| Operación | Aplicación propuesta |
|---|---|
| Renovar el mismo plan | Se suma al vencimiento actual; si venció, comienza al aprobar |
| Mensual → anual | Próximo vencimiento |
| Anual → mensual | Próximo vencimiento |
| Basic → Pro | Inmediata después del pago |
| Basic/Pro → Ultimate | Inmediata tras cotización y pago |
| Pro → Basic | Próximo vencimiento y resolución del exceso de gimnasios |
| Ultimate → Pro/Basic | Próximo vencimiento y revisión de límites |
| Cancelar | Al finalizar el periodo ya pagado |

Regla de producto recomendada: **upgrades inmediatos; downgrades y cambios de periodicidad al siguiente vencimiento**.

Solo debe existir un cambio futuro pendiente por suscripción. El owner puede verlo y cancelarlo antes de que se haga efectivo.

## 10. Relación entre plan y modo

Para el piloto se recomienda mantener estas dimensiones independientes:

- El plan (`BASIC`, `PRO`, `ULTIMATE`) limita la cantidad de gimnasios y define el precio.
- El periodo (`MONTHLY`, `ANNUAL`) define duración y frecuencia de cobro.
- El modo (`SIMPLE`, `FULL`) define las funciones y tipos de usuario disponibles en cada gimnasio.

No se recomienda cobrar inicialmente un precio distinto por Simple o Full. Mantenerlos separados permitirá medir qué funciones usan los clientes y cuánto valoran la capacidad multi-gimnasio sin confundir ambas señales.

## 11. Reglas de seguridad y consistencia

1. Una cuenta global puede tener distintos roles en distintos gimnasios.
2. No se revela la existencia ni los roles de una cuenta al enviar una invitación.
3. Toda invitación requiere aceptación del destinatario.
4. El owner no puede perder accidentalmente la propiedad; debe existir transferencia formal y auditada.
5. Los cambios de modo, plan, límite, roles y propiedad deben quedar en auditoría.
6. Archivar un gimnasio o desactivar Full no elimina datos ni desactiva globalmente a sus usuarios.
7. Los permisos se validan siempre en el backend para el gimnasio activo.
8. Las operaciones offline se separan por gimnasio y no pueden sincronizarse bajo otro contexto.
9. La suscripción pertenece a la organización; las membresías vendidas a los clientes continúan perteneciendo a cada gimnasio.
10. La ficha `Member` puede enlazarse a una cuenta global, pero sus datos comerciales y su historial siguen aislados por gimnasio.

## 12. Estrategia de migración desde la versión actual

Una migración futura podría realizarse así:

1. Crear una `Organization` por cada gimnasio existente.
2. Convertir al administrador que corresponda en `OWNER`; esta selección necesita una regla explícita si hay varios administradores.
3. Relacionar el gimnasio existente con su organización.
4. Convertir usuarios `ADMIN` y `RECEPTIONIST` actuales en relaciones por gimnasio.
5. Trasladar la suscripción vigente del gimnasio a la organización sin cambiar su vencimiento.
6. Establecer inicialmente `operationMode = SIMPLE` o `FULL` según la experiencia que se decida publicar.
7. Sustituir el `gymId` permanente del usuario por selección segura de contexto.
8. Adaptar JWT, guards, sincronización y caché local para el gimnasio seleccionado.

No debe eliminarse `User.gymId` hasta que todos los servicios dejen de depender de él. La transición requiere migración progresiva y pruebas de aislamiento entre tenants.

## 13. Decisiones pendientes antes de implementar

- Precio mensual y anual de Basic y Pro.
- Si continuará existiendo prueba gratuita y qué capacidad/modo ofrecerá.
- Duración exacta del periodo de gracia por falta de pago.
- Quién puede crear recepcionistas y entrenadores.
- Si `ORGANIZATION_ADMIN` puede gestionar facturación.
- Política definitiva de prorrateo o crédito para upgrades.
- Si los gimnasios fuera del límite quedan archivados o en solo lectura.
- Qué administrador actual se convierte en owner durante la migración.
- Si el modo Full tendrá precio propio después de validar el piloto.
- Alcance exacto de las cuentas de miembros y entrenadores.

## 14. Orden sugerido de implementación

1. Separar identidad y acceso por gimnasio mediante relaciones e invitaciones.
2. Introducir organización y owner sin cambiar todavía la operación existente.
3. Permitir selección segura de gimnasio y adaptar el contexto JWT/offline.
4. Mover la suscripción a la organización y separar plan de periodo.
5. Implementar límites Basic/Pro/Ultimate y cambios programados.
6. Añadir `operationMode` y presentar inicialmente la interfaz actual como Simple.
7. Activar gradualmente funciones Full: personal, asistencia, entrenadores y cuentas de miembros.
8. Incorporar auditoría, transferencia de propiedad y reglas de archivo/reactivación.

Cada etapa debe conservar el aislamiento por gimnasio, la operación local-first y la recuperación segura de datos.
