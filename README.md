<p align="center">
  <h1 align="center">claude-code-limiter</h1>
  <p align="center">
    Comparte una sola suscripción de Claude Code entre tu equipo — con cuotas por usuario, presupuesto de créditos y kill switch.
  </p>
</p>

<p align="center">
  <a href="https://github.com/rmm-01/claude-code-limiter-con-verificador-uninstall"><img src="https://img.shields.io/badge/repo-rmm--01-blue" alt="repo"></a>
  <a href="https://github.com/howincodes/claude-code-limiter/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
</p>

<p align="center">
  <b>Una suscripción. Varios usuarios. Uso justo para todos.</b>
</p>

> **Fork**
> Este repositorio es un fork de [howincodes/claude-code-limiter](https://github.com/howincodes/claude-code-limiter) con los siguientes cambios principales sobre el upstream:
>
> 1. **Verificador de desinstalación** — el cliente no puede desinstalar el limiter sin que el admin haya habilitado el toggle `Allow self-uninstall` en el dashboard. La autorización se valida contra el servidor antes de borrar archivos.
> 2. **Bypass por cuenta personal** — si el usuario cambia su sesión de Claude Code a otra cuenta de Anthropic distinta a la registrada durante el setup, el hook pasa de largo (no cuenta ni bloquea). Los límites solo aplican a la cuenta con la que se registró el equipo.
> 3. **Soporte para Fable 5** — modelo incluido en el conteo con peso de créditos configurable (15 por defecto) y color teal en ambos dashboards.
> 4. **Tracking por versión de modelo** — el uso se registra por versión específica (ej. `opus-4-6`, `fable-5`) mientras los límites se aplican a nivel de familia (opus, sonnet, etc.).
> 5. **Control de Agent View / Remote Control** — toggle por usuario en el dashboard (OFF por defecto). El admin habilita Agent View y Remote Control por usuario; el hook sincroniza el estado a `managed-settings.json` y su backup.
> 6. **Detección de tampering** — el servidor compara hashes SHA-256 de `managed-settings.json` para detectar manipulación. Se muestra un banner de alerta en ambos dashboards.
> 7. **Límites por effort level** — controla el nivel máximo de razonamiento (low/medium/high/xhigh/max) por usuario. Multiplicadores de effort configurables que multiplican el costo base de créditos.
> 8. **Control de Workflows / Subagentes** — toggle por usuario para habilitar/deshabilitar workflows masivos y subagentes. Bloquea tanto la herramienta `Workflow` como `Agent` en PreToolUse.
> 9. **Tracking de tokens reales** — lee `input_tokens` y `output_tokens` del transcript JSONL de Claude Code y los registra en el servidor. Permite poner límites por tokens consumidos.
> 10. **Hook de repo para Claude Code web** — script stateless en `.claude/hooks/` que funciona en sesiones cloud (claude.ai/code). Comando `gen-repo-hook` para generar la configuración automáticamente.
>
> Además incluye varios fixes específicos para Windows (ACLs, watchdog, reinstalación sobre instalación previa). Ver `git log` para detalles.

> **Beta temprana** — Proyecto en desarrollo activo. Las cosas pueden romperse, las APIs pueden cambiar. Si encuentras un problema, [abre un issue](https://github.com/rmm-01/claude-code-limiter-con-verificador-uninstall/issues).

---

## :fire: El problema

Estás pagando **$100/mes** por Claude Code Max. Tres desarrolladores comparten la cuenta. Quizá también un becario.

Entonces alguien descubre Opus y manda 50 prompts en una hora. La suscripción entera queda rate-limited hasta el otro día. El resto no puede usar nada.

Claude Code **no tiene controles de uso integrados**. No hay límites por usuario, ni cuotas, ni visibilidad de quién consume qué. Estás a ciegas y pagas la cuenta.

## :bulb: La solución

**claude-code-limiter** agrega una capa completa de control sobre suscripciones compartidas de Claude Code:

- **Cuotas por usuario** — cada persona tiene su propio límite diario/semanal/mensual
- **Presupuesto de créditos** — un único presupuesto entre todos los modelos; el usuario decide cómo gastarlo
- **Dashboard en tiempo real** — ver quién está usando qué, en vivo
- **Kill switch** — revocar acceso al instante y forzar logout remoto

Funciona instalando un hook a nivel de sistema en cada máquina. El hook consulta los límites en cada prompt contra un servidor que hosteas. El usuario no puede bypasearlo sin la contraseña de admin/root de la máquina.

```
┌───────────────────────────────────────────────────────┐
│              Tu servidor (Docker / Cloud)             │
│  ┌────────-─┐  ┌──────────┐  ┌─────────────────────┐  │
│  │ REST API │  │  SQLite  │  │   Dashboard Web     │  │
│  └────┬─────┘  └────┬─────┘  └──────────┬──────────┘  │
│       └─────────────┴───────────────────┘             │
└────────────┬─────────────┬──────────────┬─────────────┘
             │             │              │
        ┌────┘       ┌─────┘       ┌──────┘
        ▼            ▼             ▼
   ┌──────────┐ ┌─────────┐ ┌────────────┐
   │ MacBook  │ │ Laptop  │ │  Tu        │
   │ Dev A    │ │ Dev B   │ │  navegador │
   │          │ │         │ │ (Dashboard)│
   │ hook.js  │ │ hook.js │ └────────────┘
   │    ↕     │ │    ↕    │
   │  caché   │ │  caché  │
   │  local   │ │  local  │
   └──────────┘ └─────────┘ 
```

Los hooks consultan la caché local primero (latencia cero), sincronizan con el servidor en segundo plano, y **fail-closed** si falta algo. Borrar archivos locales no resetea contadores — el servidor es la única fuente de verdad.

---

## :rocket: Inicio rápido

### 1. Desplegar el servidor

El servidor debe ser alcanzable desde cada máquina de usuario. Desplegalo en cualquier lugar con URL pública o IP de red local.

**Opción A: Docker en VPS**
```bash
docker build -t claude-limiter-local packages/server
docker run -d \
  --name claude-limiter \
  -p 3000:3000 \
  -v claude-limiter-data:/data \
  -e ADMIN_PASSWORD=tu-password-seguro \
  claude-limiter-local
```

**Opción B: Docker Compose con HTTPS automático**
```bash
cd packages/server
DOMAIN=limiter.tudominio.com ADMIN_PASSWORD=secret docker compose up -d
```
Caddy maneja los certificados SSL automáticamente.

**Opción C: Red local / oficina**
```bash
cd packages/server
npm install
ADMIN_PASSWORD=secret node bin/server.js
# Servidor accesible en http://192.168.x.x:3000 — alcanzable desde toda la red
```

> **Importante:** cada máquina de usuario debe poder conectarse al servidor. `localhost` solo sirve en la misma máquina. Usa una URL pública, IP de VPS, o IP de red local.

### 2. Agregar usuarios en el dashboard

Abrí la URL del servidor (ej. `https://limiter.tudominio.com/dashboard`) y entrá con tu contraseña de admin.

Click en **Add User** → nombre, límites, presupuesto de créditos → copiá el código de instalación.

### 3. Instalar en cada máquina

**Linux / macOS:**
```bash
sudo node packages/cli/src/installer.js setup \
  --code CLM-alice-a8f3e2 \
  --server https://limiter.tudominio.com
```

**Windows (PowerShell como Administrador):**
```powershell
node packages\cli\src\installer.js setup `
  --code CLM-alice-a8f3e2 `
  --server https://limiter.tudominio.com
```

Reiniciar Claude Code. Listo. El usuario queda limitado.

---

## :no_entry: Qué ve el usuario al ser bloqueado

Cuando un usuario alcanza su límite, el próximo prompt se bloquea con un mensaje claro:

```
Daily sonnet limit reached for Alice.
Used 20/20 prompts today.

All usage today:
  fable:   0/2   (2 left)
  haiku:  12/40  (28 left)
  opus:    5/5   (0 left)
  sonnet: 20/20  (0 left)

Credit balance: 0/100

Options:
  Switch to another model (if quota remains)
  Try again later
```

Cuando el admin revoca acceso remotamente:

```
Your Claude Code access has been revoked by the admin.
Contact your admin to restore access.
```

Cuando se intenta usar un modelo fuera de su ventana horaria:

```
Opus is only available 9:00 AM - 6:00 PM (America/New_York).
Current time: 8:15 PM. Try sonnet or haiku instead.
```

---

## :sparkles: Funcionalidades

### Tipos de límite

| Tipo | Ejemplo | Descripción |
|------|---------|-------------|
| **Cap por modelo** | `opus: 5/día, sonnet: 20/día` | Tope duro por modelo y ventana de tiempo |
| **Presupuesto de créditos** | `100 créditos/día` | Un único presupuesto entre todos los modelos — opus cuesta 10, sonnet 3, haiku 1 |
| **Horario por modelo** | `opus: 9am–6pm` | Restringir modelos caros al horario laboral |
| **Effort level** | `max_effort: high` | Bloquea niveles de razonamiento superiores al permitido |
| **Subagentes / Workflows** | `subagents: 50/día` | Tope de ejecuciones de subagentes y workflows |
| **Tokens** | `tokens: 500000/día` | Tope de tokens reales (input + output) consumidos |

### Tipos de ventana

| Ventana | Comportamiento |
|---------|----------------|
| `daily` | Resetea a medianoche local |
| `weekly` | Resetea el lunes a medianoche |
| `monthly` | Resetea el 1 del mes |
| `sliding_24h` | Ventana rodante de 24h — sin trucos a medianoche |

### Pesos de créditos (configurables)

| Modelo | Costo por defecto |
|--------|-------------------|
| Fable | 15 créditos |
| Opus | 10 créditos |
| Sonnet | 3 créditos |
| Haiku | 1 crédito |

Con un presupuesto de **100 créditos/día**, un usuario puede hacer: **6 Fable**, **o 10 Opus**, **o 33 Sonnet**, **o 100 Haiku**, o cualquier mezcla.

### Multiplicadores de effort (configurables)

El costo base de créditos se multiplica según el nivel de razonamiento:

| Nivel | Multiplicador | Opus (10cr base) |
|-------|---------------|------------------|
| Low | ×0.5 | 5 créditos |
| Medium | ×1 | 10 créditos |
| High | ×2 | 20 créditos |
| XHigh | ×4 | 40 créditos |
| Max | ×6 | 60 créditos |

Configurables en **Dashboard → Settings → Multiplicadores de Effort**.

### Controles de admin

- :bar_chart: **Dashboard en tiempo real** — barras de uso en vivo, desglose por usuario, feed de eventos por WebSocket
- :zap: **Kill switch** — revoca acceso al instante + fuerza `claude auth logout` en la máquina del usuario
- :pause_button: **Pausar / reanudar** — suspender temporalmente sin revocar
- :gear: **Push de configuración en vivo** — cambia límites en el servidor; los usuarios los reciben en el próximo prompt (sin reinstalar)
- :shield: **Verificador de desinstalación** (fork) — el usuario no puede desinstalar el limiter sin que el admin habilite el toggle en User Detail
- :bust_in_silhouette: **Bypass por cuenta personal** (fork) — si el usuario cambia a otra cuenta de Anthropic distinta a la registrada, los límites no aplican
- :robot: **Control de Agent View / Remote Control** (fork) — toggle por usuario, OFF por defecto. Sincroniza a `managed-settings.json` + backup
- :mag: **Tracking por versión** (fork) — registra la versión específica de modelo usada (ej. `opus-4-6`, `fable-5`), visible en el detalle del usuario
- :warning: **Detección de tampering** (fork) — alerta en dashboard cuando el hash de `managed-settings.json` no coincide con el esperado
- :brain: **Límites por effort level** (fork) — cap por usuario del nivel de razonamiento (low/medium/high/xhigh/max) + multiplicadores de créditos configurables
- :octopus: **Control de Workflows / Subagentes** (fork) — toggle por usuario para habilitar/deshabilitar workflows masivos y subagentes + límite numérico configurable
- :straight_ruler: **Tracking de tokens reales** (fork) — lee `input_tokens` y `output_tokens` del transcript de Claude y los registra. Permite poner topes por tokens consumidos
- :globe_with_meridians: **Cobertura Claude Code web** (fork) — hook de repo stateless que funciona en sesiones cloud (claude.ai/code) + comando `gen-repo-hook`

---

## :gear: Cómo funciona

Cada prompt de Claude Code pasa por cuatro eventos de hook:

```
Usuario escribe un prompt
        │
        ▼
┌─ SessionStart ───────────────────────────────────┐
│  Captura modelo activo (fable/opus/sonnet/haiku)  │
│  Sincroniza config + límites desde servidor      │
└──────────────────────────────────────────────────┘
        │
        ▼
┌─ UserPromptSubmit (LA COMPUERTA) ────────────────┐
│  Llama al servidor /check → ¿Permitido?          │
│  El servidor evalúa: status → horario →          │
│    modelo → créditos → effort → subagents →      │
│    tokens                                        │
│  Si rechaza → bloquea con resumen de uso         │
│  Si servidor caído → cae a caché local           │
└──────────────────────────────────────────────────┘
        │ (permitido)
        ▼
   Claude hace su trabajo
   (las tool calls pasan por PreToolUse para
    kill/pause + bloqueo de Workflow/Agent +
    enforcement de effort level)
        │
        ▼
┌─ Stop ──────────────────────────────────────────┐
│  Incrementa contador de uso (local + servidor)  │
│  Registra tokens reales (input + output)        │
│  Una cuenta por turno completado                │
└─────────────────────────────────────────────────┘
```

**Decisiones de diseño clave:**
- Se cuentan **turnos** (prompts del usuario), no tool calls individuales
- El hook tiene **cero dependencias de npm** — solo módulos built-in de Node.js
- Local-first: las consultas son instantáneas, la sincronización con servidor es en segundo plano
- **Fail-closed**: si se borran todos los archivos del limiter, el acceso queda denegado (no abierto)

---

## :lock: Seguridad

8 capas de protección. La única forma de bypasear esto es con la contraseña root/admin de la máquina — y si alguien la tiene, ya tiene acceso a las credenciales de la suscripción de todos modos.

| # | Capa | Qué previene |
|---|------|--------------|
| 1 | **Managed settings** | `managed-settings.json` en directorio del sistema — no puede ser sobrescrito por config de usuario o proyecto |
| 2 | **allowManagedHooksOnly** | Los usuarios no pueden definir sus propios hooks para bypasear el limiter |
| 3 | **Permisos de archivo del SO** | Hook, config y archivos del servidor son root-owned — usuarios pueden leer pero no modificar |
| 4 | **Daemon watchdog** | Corre cada 5 min, verifica integridad SHA-256, restaura archivos manipulados desde un backup root-only |
| 5 | **Tracking server-side** | Borrar los archivos de uso locales no resetea contadores — el servidor es la fuente de verdad |
| 6 | **Kill switch** | Bloqueo remoto instantáneo + fuerza `claude auth logout` |
| 7 | **Tokens por usuario** | Cada usuario tiene un token único guardado en archivo root-only — previene suplantación |
| 8 | **Fail-closed** | Config faltante = denegado, no permitido. El watchdog restaura archivos en menos de 5 min |

### Ubicación de archivos

```
macOS:   /Library/Application Support/ClaudeCode/
Linux:   /etc/claude-code/
Windows: C:\Program Files\ClaudeCode\

<base>/
├── managed-settings.json       ← hooks + allowManagedHooksOnly
├── .backup/                    ← root-only, fuente de restauración del watchdog
│   ├── managed-settings.json
│   ├── hook.js
│   ├── config.json
│   └── checksums.json          ← hashes SHA-256 de todos los archivos protegidos
└── limiter/
    ├── hook.js                 ← el rate limiter (cero deps de npm)
    ├── config.json             ← límites cacheados + pesos de créditos
    ├── server.json             ← URL del servidor + token de auth
    ├── cache.json              ← última respuesta del servidor (fallback offline)
    ├── session-model.txt       ← modelo actual
    └── usage/
        └── YYYY-MM-DD.json    ← contadores locales
```

> **Nota Windows:** los permisos en Windows son parciales (`icacls` no es tan estricto como `chmod` root). Las capas activas en Windows son: managed-settings + allowManagedHooksOnly + watchdog (tarea programada como SYSTEM cada 5 min) + tracking server-side + kill switch + fail-closed.

---

## :whale: Self-hosting

### Docker (recomendado)

```bash
docker build -t claude-limiter-local packages/server
docker run -d \
  --name claude-limiter \
  -p 3000:3000 \
  -v claude-limiter-data:/data \
  -e ADMIN_PASSWORD=tu-password-seguro \
  claude-limiter-local
```

### Docker Compose con HTTPS

```yaml
# docker-compose.yml
version: "3.8"
services:
  limiter:
    image: claude-limiter-local
    environment:
      - ADMIN_PASSWORD=tu-password-seguro
    volumes:
      - limiter-data:/data

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
    depends_on:
      - limiter

volumes:
  limiter-data:
  caddy-data:
```

```
# Caddyfile
limiter.tudominio.com {
    reverse_proxy limiter:3000
}
```

### Modo LAN (sin dominio)

Corre Docker en cualquier máquina de tu red local. Apunta a los usuarios a `http://192.168.1.x:3000`. No hace falta HTTPS para redes internas. El timeout de 3 segundos del hook maneja gracefully cortes de Wi-Fi cayendo a caché local.

---

## :wrench: Configuración

### Reglas de límite

Los límites se configuran por usuario vía dashboard. Las reglas se apilan — la más restrictiva gana.

**Cap por modelo:**
```json
{ "type": "per_model", "model": "opus", "window": "sliding_24h", "value": 5 }
```

**Presupuesto de créditos:**
```json
{ "type": "credits", "window": "daily", "value": 100 }
```

**Restricción horaria:**
```json
{
  "type": "time_of_day",
  "model": "opus",
  "schedule_start": "09:00",
  "schedule_end": "18:00",
  "schedule_tz": "America/New_York"
}
```

**Límite de subagentes/workflows:**
```json
{ "type": "subagents", "window": "daily", "value": 50 }
```

**Límite de tokens:**
```json
{ "type": "tokens", "window": "daily", "value": 500000 }
```

### Pesos de créditos

Configurados por equipo en el servidor. Default:

```json
{ "fable": 15, "opus": 10, "sonnet": 3, "haiku": 1 }
```

### Multiplicadores de effort

```json
{ "low": 0.5, "medium": 1, "high": 2, "xhigh": 4, "max": 6 }
```

Cambialos en **Dashboard → Settings** para que coincidan con tus prioridades de uso.

### Orden de evaluación

Todas las reglas se evalúan en cada prompt. La primera regla que niega, gana:

```
1. ¿Usuario killed o paused?           → BLOQUEA
2. ¿Modelo dentro de su horario?       → si no, BLOQUEA
3. ¿Cap por modelo excedido?           → si sí, BLOQUEA
4. ¿Presupuesto de créditos excedido?  → si sí, BLOQUEA
5. ¿Effort level sobre el cap?         → si sí, BLOQUEA
6. ¿Subagentes sobre el límite?        → si sí, BLOQUEA
7. ¿Tokens consumidos sobre el tope?   → si sí, BLOQUEA
8. PERMITE
```

---

## :computer: Referencia de CLI

### Setup (correr en cada máquina de usuario)

**Linux / macOS:**
```bash
sudo node packages/cli/src/installer.js setup --code <CÓDIGO> --server <URL>
```

**Windows (PowerShell Admin):**
```powershell
node packages\cli\src\installer.js setup --code <CÓDIGO> --server <URL>
```

Instala el hook, managed settings, watchdog, y registra contra el servidor. Requiere privilegios elevados porque escribe en directorios protegidos del sistema.

> **Nota fork:** el installer también limpia automáticamente cualquier instalación previa antes de escribir (cierra Claude Code, borra watchdog viejo, recupera ACLs rotas). Esto permite reinstalar sobre una instalación parcial fallida sin pasos manuales.

### Estado

```bash
node packages/cli/src/installer.js status
```

```
╔══════════════════════════════════════════════╗
║     claude-code-limiter — Status             ║
╚══════════════════════════════════════════════╝

  User:          Alice
  Date:          2026-03-24
  Active model:  sonnet
  Server:        https://tu-servidor:3000

  ┌────────────┬───────┬───────┬──────────────────────┬──────────┐
  │ Model      │ Used  │ Limit │ Progress             │ Left     │
  ├────────────┼───────┼───────┼──────────────────────┼──────────┤
  │ opus       │   3   │   5   │ ██████████░░░░░░░░   │    2     │
  │ sonnet     │  12   │  20   │ ██████████░░░░░░░░   │    8     │
  │ haiku      │   0   │   ∞   │   ∞ ilimitado        │    ∞     │
  └────────────┴───────┴───────┴──────────────────────┴──────────┘

  Credits: 61/100 restantes
```

### Forzar sincronización

```bash
sudo node packages/cli/src/installer.js sync
```

Trae la configuración y los límites actualizados del servidor de inmediato.

### Desinstalar

```bash
sudo node packages/cli/src/installer.js uninstall
```

> **Verificador (fork):** la desinstalación consulta primero al servidor (`/api/v1/uninstall-check`). Si el admin no habilitó `allow_self_uninstall` en el dashboard para ese usuario, la operación falla con HTTP 403. También fail-closed si el `server.json` no existe — un estado de tampering o instalación rota.

---

## :question: Preguntas frecuentes

### ¿Puede un usuario bypasear esto?

No sin la contraseña root/admin de la máquina. El hook corre desde un directorio protegido del sistema con archivos root-owned. `allowManagedHooksOnly` impide que los usuarios agreguen sus propios hooks. El watchdog restaura cualquier archivo manipulado cada 5 min. Y si borran todo, el hook fail-cloase (deniega acceso, no abre).

### ¿Qué pasa si un usuario borra los archivos de uso local?

Nada. El uso se trackea server-side. Borrar archivos locales solo hace que el hook caiga a contadores del servidor en la próxima consulta. El watchdog además restaura los archivos de config desde el backup root-only.

### ¿Afecta a Claude.ai (la app web)?

No. Esto solo controla **Claude Code** (la CLI y claude.ai/code). Claude.ai (chat normal en el browser) no se ve afectado.

### ¿Funciona con Claude Code web (claude.ai/code)?

Sí, con el hook de repo. Ejecutá `gen-repo-hook` para generar los archivos necesarios en `.claude/` del repositorio. Los hooks de repo se ejecutan automáticamente en sesiones cloud. Los usuarios también pueden configurar las variables de entorno `CLAUDE_LIMITER_URL` y `CLAUDE_LIMITER_TOKEN` en su entorno cloud.

### ¿Qué pasa con workflows masivos y subagentes?

El admin puede deshabilitar workflows/subagentes por usuario con el toggle en User Detail. También puede poner un límite numérico (ej. 50 subagentes/día). Cuando un usuario intenta ejecutar una herramienta `Workflow` o `Agent` sin permiso, se bloquea en PreToolUse.

### ¿Qué pasa si el servidor se cae?

El hook cae a límites y datos de uso cacheados localmente. Los límites se siguen aplicando. Cuando el servidor vuelve, todo se sincroniza. Si no hay caché (instalación fresca, servidor nunca alcanzado), el hook deniega acceso (fail-closed).

### ¿Cuenta tool calls o prompts?

**Prompts (turnos).** Un solo prompt puede disparar más de 10 tool calls (leer archivos, escribir código, correr comandos). Contamos el turno, no cada tool call. Un prompt = una unidad de cuota, sin importar cuánto trabajo haga Claude.

### ¿Qué pasa con auto-continue? ¿Cuenta como múltiples turnos?

Sí. Si Claude alcanza un límite de output y auto-continúa, cada continuación dispara un evento `Stop` y cuenta como turno separado. Esto es intencional — cada turno consume capacidad real del modelo contra la suscripción. Los admins deberían fijar límites teniendo esto en cuenta.

### ¿El bypass por cuenta personal cómo funciona exactamente?

Durante el `setup`, el installer guarda el email de la cuenta de Claude actualmente logueada en `config.json` como `allowed_email`. En cada prompt, el hook ejecuta `claude auth status` y compara el email activo contra el guardado. Si difieren → bypass (no cuenta, no bloquea). Si coinciden o el comando falla → los límites se aplican normal (fail-safe). El email se cachea 1h para no spam comandos.

### ¿Puedo usar esto para un equipo de trabajo?

Sí. Funciona para cualquier grupo que comparta una sola suscripción de Claude Code — familias, equipos chicos, estudios. Cada deployment soporta un admin y múltiples usuarios.

---

## :building_construction: Estructura del proyecto

```
claude-code-limiter-con-verificador-uninstall/
├── package.json                ← workspace raíz (monorepo)
├── packages/
│   ├── cli/                    ← cliente CLI (se instala en cada máquina)
│   │   ├── bin/
│   │   │   └── cli.js          ← entry point
│   │   └── src/
│   │       ├── hook.js         ← hook standalone (cero deps de npm)
│   │       ├── repo-hook.js    ← hook stateless para repos (Claude Code web)
│   │       ├── gen-repo-hook.js ← generador de hooks de repo
│   │       └── installer.js    ← setup, uninstall, sync, status
│   ├── server/                 ← servidor admin (REST + WebSocket + dashboard)
│   │   ├── bin/
│   │   │   └── server.js
│   │   ├── Dockerfile
│   │   ├── docker-compose.yml
│   │   └── src/
│   │       ├── server/
│   │       │   ├── index.js    ← Express app
│   │       │   ├── db.js       ← schema SQLite + migraciones
│   │       │   ├── ws.js       ← updates en vivo por WebSocket
│   │       │   ├── routes/
│   │       │   │   ├── hook-api.js   ← /api/v1/* (comunicación hook)
│   │       │   │   └── admin-api.js  ← /api/admin/* (backend dashboard)
│   │       │   └── services/
│   │       │       ├── limiter.js    ← motor de evaluación de límites
│   │       │       ├── usage.js      ← tracking + agregación
│   │       │       └── auth.js       ← JWT (admin) + token (hook)
│   │       └── dashboard/      ← dashboard vanilla servido por el server
│   └── dashboard/              ← UI React+TS+Vite (versión nueva del dashboard)
└── tests/
    ├── api.test.js
    ├── hook.test.js
    └── limiter.test.js
```

**Tres paquetes, un monorepo:**
- **CLI** (`packages/cli`) — installer + hook standalone. El hook tiene cero dependencias de npm (solo built-ins de Node).
- **Server** (`packages/server`) — Express + better-sqlite3 + ws. Sirve REST API, dashboard y WebSocket en un solo puerto.
- **Dashboard** (`packages/dashboard`) — UI moderna React + Vite (en desarrollo, aún no reemplaza al dashboard vanilla del server).

---

## :handshake: Contribuir

PRs bienvenidos. Proyecto open source bajo licencia MIT.

```bash
# Clonar e instalar
git clone https://github.com/rmm-01/claude-code-limiter-con-verificador-uninstall.git
cd claude-code-limiter-con-verificador-uninstall
npm install

# Iniciar servidor en desarrollo
cd packages/server
npm install
ADMIN_PASSWORD=devpass node bin/server.js

# Tests (TODO — placeholders por ahora)
npm test
```

**Reglas clave:**
- `packages/cli/src/hook.js` debe mantener **cero dependencias de npm** — solo built-ins de Node
- El servidor usa Express + better-sqlite3 — mantenerlo simple
- El dashboard servido por el server es HTML/CSS/JS vanilla — sin build step ni framework

---

## :page_facing_up: Licencia

[MIT](LICENSE) — Basha, 2026 (upstream original)
Modificaciones del fork: Ricardo Mendoza, 2026.

---

<p align="center">
  <b>Ya no compartas a ciegas. Empieza a compartir con reglas.</b><br>
  <a href="https://github.com/rmm-01/claude-code-limiter-con-verificador-uninstall">Fork (este repo)</a> · <a href="https://github.com/howincodes/claude-code-limiter">Upstream original</a> · <a href="https://github.com/rmm-01/claude-code-limiter-con-verificador-uninstall/issues">Issues</a>
</p>

## Créditos

- [@Ageb1234](https://github.com/Ageb1234) (Angello Espinoza) — por ayudar a testear
