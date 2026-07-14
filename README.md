# RS_CORE_TechSpecValidation

Cuestionario de **validación tecnológica** de RocaSalvatella: un único fichero HTML autocontenido que se envía a cualquier cliente para recoger su TechSpec (stack, seguridad, compliance, integraciones) y contrastarla con nuestro stack de referencia (React + FastAPI + PostgreSQL + Azure), punto por punto, con tres veredictos posibles: **Igual / Adaptar / Bloqueante**.

**Desplegado (N3 activo)** en Azure Static Web Apps · suscripción *TechSolutions Projects AI* · RG `rg-techspec`:

- Cuestionario: <https://purple-water-0e8e5fa03.7.azurestaticapps.net/?c=CLIENTE>
- Panel interno: <https://purple-water-0e8e5fa03.7.azurestaticapps.net/admin> (rol `rs`)
- Almacén: cuenta `rstechspecdata` → tabla `techspecresponses`

Redesplegar = push a `main` (workflow `Azure Static Web Apps CI/CD`). Reproducir en limpio: `./deploy.sh`.

## Cómo funciona

1. RS envía al cliente la URL (o el propio fichero `index.html`).
2. El cliente responde: 12 secciones (frontend, backend, datos, infraestructura, CI/CD, identidad, ciberseguridad, IA/LLM, testing, observabilidad, compliance, integraciones y licenciamiento) + ficha de contexto.
3. Mientras responde, todo se autoguarda en el `localStorage` de su navegador (puede cerrar y volver).
4. Al pulsar **Enviar a RS**, las respuestas viajan a la API (`/api/submit`) y aterrizan en una tabla de Azure. Con **Guardar copia** puede además descargar el HTML con las respuestas **incrustadas** (`<script id="saved-state">`) como respaldo.
5. El equipo de RS las consulta en el **panel de consolidación** (`/admin`, protegido): comparación cliente × requisito, semáforo de bloqueantes y detalle por respuesta.

En N1/N2 el documento **es** el dato (sin backend). En N3 el dato se centraliza en Azure y se explota desde el panel.

## Niveles de recogida

El producto está pensado para crecer por niveles. Este repo implementa N1 y N2; N3 es el destino para convertirlo en producto RS.

| Nivel | Qué es | Dónde viven las respuestas | Qué requiere |
| --- | --- | --- | --- |
| **N1 — Navegador** | El cliente responde online | `localStorage` de su navegador (solo su dispositivo) | Nada: cualquier hosting estático |
| **N2 — Fichero devuelto** | El cliente pulsa Guardar y devuelve el HTML relleno por email | Dentro del fichero devuelto | Nada técnico; proceso de recepción (buzón, carpeta por cliente) |
| **N3 — Recogida centralizada** | Al enviar, las respuestas viajan solas a un almacén de RS | API + almacén gestionado por RS (tabla/BBDD), con panel de consolidación multi-cliente | Azure Static Web Apps + Functions integradas (o Container Apps si crece a producto con panel), identidad y RBAC de Azure |

El salto a N3 es lo que convierte el cuestionario en **producto**: respuestas estructuradas por cliente, comparables entre sí, con dashboard y sin depender de que nadie devuelva un fichero.

## Despliegue

Sigue la norma de despliegue RS (definida en `RS_CORE_AgentKit`):

| Nivel | Destino | Por qué |
| --- | --- | --- |
| N1/N2 (este repo) | **GitHub Pages** (interino) o **Azure Static Web Apps** (norma) | Es 100% estático. Pages funciona hoy sin permisos Azure; SWA Free es el destino correcto (repo privado + URL pública + dominio propio). |
| N3 | **SWA + Azure Functions** (API integrada) | El formulario hace POST a `/api/submit`; las respuestas caen en Table Storage/Cosmos. Mismo repo, misma URL. |
| N3 con panel / multi-tenant | **Azure Container Apps** | Cuando haya backend propio y panel de consolidación: dockerizado, escala a cero, pago por consumo. |
| CI/CD de todo | **GitHub Actions** | `az staticwebapp create` deja el workflow cableado; cada push a `main` despliega. |

### Comandos

```bash
# GitHub Pages (interino, repo público — solo N1/N2, la API no corre aquí)
gh api -X POST repos/<org>/<repo>/pages -f "source[branch]=main" -f "source[path]=/"
```

### Activar Nivel 3 (SWA + Functions + Table Storage)

El código ya está en el repo (`api/src/functions/submit.js` + botón «Enviar a RS» en `index.html`). Con rol `Contributor` sobre un resource group, la activación es:

```bash
RG=<rg>; LOC=westeurope; SUB=<subscription-id>

# 1. Almacén de respuestas (Table Storage; céntimos al mes)
az storage account create -n rstechspec -g $RG -l $LOC --sku Standard_LRS --subscription $SUB
CS=$(az storage account show-connection-string -n rstechspec -g $RG --subscription $SUB -o tsv)

# 2. Static Web App con la API integrada (Free incluye las Functions gestionadas)
az staticwebapp create \
  --name rs-techspec-validation --resource-group $RG --subscription $SUB \
  --source https://github.com/RocaSalvatellaAi/RS_CORE_TechSpecValidation --branch main \
  --app-location "/" --api-location "api" --location $LOC --sku Free \
  --token "$(gh auth token)"

# 3. Conectar la API con el almacén
az staticwebapp appsettings set -n rs-techspec-validation --subscription $SUB \
  --setting-names STORAGE_CONNECTION_STRING="$CS"
```

Cada cliente recibe su URL con identificador: `https://<swa>.azurestaticapps.net/?c=<cliente>` — el parámetro `c` particiona las respuestas en la tabla `techspecresponses` (una fila por envío, JSON completo troceado en `payload0..N`).

Leer las respuestas:

```bash
az storage entity query --table-name techspecresponses \
  --connection-string "$CS" \
  --filter "PartitionKey eq '<cliente>'" -o json
```

### Panel de consolidación (`/admin`)

Vista interna para el equipo RS, servida por la misma SWA en `/admin` y protegida por rol `rs`:

- **KPIs**: respuestas recibidas, clientes distintos, bloqueantes marcados, último envío.
- **Matriz de comparación**: filas = requisitos (por sección), columnas = respuestas; un punto de color por veredicto (Igual/Adaptar/Bloqueante/N/D) con alternativa y notas en el tooltip. Filtro "solo requisitos con algún bloqueante" = el semáforo.
- **Detalle por respuesta**: todas las contestaciones de un cliente, con su ficha de contexto.

Acceso: se entra vía `/.auth/login/aad` (Entra ID). Para dar acceso a alguien, asignarle el rol `rs` en la SWA:

```bash
# invitar a un usuario al rol "rs" (genera enlace de invitación)
az staticwebapp users invite -n rs-techspec-validation \
  --authentication-provider aad --user-details <email> \
  --roles rs --domain <swa>.azurestaticapps.net --invitation-expiration-in-hours 168 --subscription $SUB
```

En GitHub Pages el botón «Enviar a RS» falla con elegancia: avisa al usuario y le remite a «Guardar copia» (N2). El fichero descargado sigue funcionando como respaldo universal.

## Roles y permisos necesarios, por escenario

Verificado contra el tenant RS (los resource providers `Microsoft.Web`, `Microsoft.App` y `Microsoft.ContainerRegistry` ya están registrados en la suscripción de producción):

| Escenario | Rol mínimo | Sobre qué (scope) | Si falta, el fallo que verás |
| --- | --- | --- | --- |
| Desplegar a Static Web Apps | `Contributor` | Resource group | `AuthorizationFailed ... Microsoft.Web/staticSites/read` |
| Crear resource groups nuevos | `Contributor` | La suscripción | `AuthorizationFailed ... resourcegroups/write` |
| Container Apps (N3 con panel) | El mismo `Contributor` de RG (entorno + app + Log Analytics) | Resource group | `Microsoft.App/managedEnvironments/write` denegado |
| CI/CD empujando imágenes al ACR | `AcrPush` para la identidad de GitHub Actions (`AcrPull` para la app) | El registro (ACR) | `unauthorized: authentication required` en `docker push` |
| Crear service principals / identidades federadas para Actions | Administrador: permisos de Entra ID (crear apps) + `Owner`/`User Access Administrator` (asignar roles) | Tenant / suscripción | `Insufficient privileges to complete the operation` |

Notas:
- **No existe rol integrado específico para Static Web Apps** ("Website Contributor" cubre `sites/*`, no `staticSites/*`): `Contributor` de RG es el mínimo práctico. Alternativa de mínimo privilegio: rol custom con `Microsoft.Web/staticSites/*` + `Microsoft.Resources/deployments/*`.
- **Una sola concesión desbloquea todos los niveles**: `Contributor` sobre un RG cubre SWA, Functions y Container Apps. Solo el ACR pide `AcrPush` adicional.
- Lado GitHub: el `--token` de `az staticwebapp create` sale de `gh auth token` (scopes `repo` + `workflow`) y solo sirve para inyectar el workflow de Actions.

## Personalización por cliente

El contenido vive en dos constantes de `index.html`:

- `META.fields` — la ficha de contexto (empresa, responsables, entornos…).
- `SECTIONS` — las 12 secciones con sus filas `[requisito, default del stack RS]`.

Para una versión con marca del cliente: duplicar el fichero, ajustar título/subtítulo del appbar y, si procede, añadir o quitar filas. **Nunca** meter datos ni logos de un cliente en este repo (es público): las versiones personalizadas viven en el repo privado del proyecto de ese cliente.

## Confidencialidad y seguridad

- Este repo es **público** y por eso no contiene ni contendrá: nombres de clientes, respuestas, logos ajenos, credenciales o URLs internas.
- Las respuestas de un cliente **jamás** se commitean aquí. En N2 se archivan en el espacio del proyecto (SharePoint/Drive del engagement); en N3, en el almacén de Azure con acceso restringido.
- El HTML no hace ninguna llamada de red (fuentes de Google aparte): todo el estado es local. En N3, el endpoint de envío debe estar detrás de HTTPS y validar origen.

## Estructura

```
index.html                    Cuestionario (consume content.js; la copia descargada lo incrusta)
admin.html                    Panel de consolidación (interno, protegido por rol "rs")
content.js                    Fuente única del contenido (META + SECTIONS) para ambos
staticwebapp.config.json      Rutas y auth de SWA (/admin y /api/responses → rol "rs")
api/
  host.json                   Config de Azure Functions
  package.json                Dependencias de la API
  src/functions/submit.js     POST /api/submit  — recibe respuestas (anónimo)
  src/functions/responses.js  GET  /api/responses — lee respuestas (rol "rs")
deploy.sh                     Provisiona todo en Azure de una tirada (idempotente)
README.md                     Este documento
```

## Roadmap

- [x] N3: `/api/submit` con SWA Functions + Table Storage y token por cliente en la URL (`?c=<id>`) — código listo, pendiente solo del rol Azure para activarlo
- [x] Panel de consolidación multi-cliente (comparativa de TechSpecs, semáforo de bloqueantes) — código listo, pendiente del rol Azure para activarlo
- [ ] Export a informe (PDF/PPTX con plantilla RS) desde las respuestas estructuradas
- [ ] Versionado del cuestionario (que cada respuesta registre contra qué versión del stack de referencia se contestó)

---

Producto interno de RocaSalvatella · mantenido por el equipo técnico (org `RocaSalvatellaAi`).
