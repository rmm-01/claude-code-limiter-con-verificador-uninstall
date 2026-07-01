# claude-code-limiter — Guía de Instalación

Control de uso para suscripciones compartidas de Claude Code. Limita prompts por usuario, modelo y presupuesto de créditos. Incluye dashboard web en tiempo real.

---

## Requisitos previos

- Node.js ≥ 18
- Docker (opción A) o Node.js en el servidor (opción B)
- Claude Code instalado en cada máquina de usuario

---

## Paso 1 — Desplegar el servidor

Elige una opción. El servidor debe ser accesible desde todas las máquinas del equipo.

### Opción A: Docker (recomendado)

```bash
docker run -d \
  --name claude-limiter \
  -p 3000:3000 \
  -v claude-limiter-data:/data \
  -e ADMIN_PASSWORD=tu-password-seguro \
  ghcr.io/howincodes/claude-code-limiter:latest
```

**Con HTTPS automático (Caddy):**

```bash
cd packages/server
DOMAIN=limiter.tudominio.com ADMIN_PASSWORD=tu-password-seguro docker compose up -d
```

### Opción B: Local / red interna

```bash
# Clonar el repo
git clone https://github.com/rmm-01/claude-code-limiter.git
cd claude-code-limiter

# Instalar dependencias del servidor
cd packages/server
npm install

# Iniciar servidor
ADMIN_PASSWORD=tu-password-seguro node bin/server.js
```

El servidor queda disponible en `http://IP-DEL-SERVIDOR:3000`.

> En red local no se necesita HTTPS. Apuntar a la IP del servidor: `http://192.168.1.x:3000`

---

## Paso 2 — Configurar usuarios en el dashboard

1. Abrir `http://IP-DEL-SERVIDOR:3000/dashboard`
2. Iniciar sesión con el `ADMIN_PASSWORD` configurado
3. Click en **Add User**
4. Completar nombre, slug y límites
5. Copiar el **código de instalación** generado (`CLM-xxx-xxxxxx`)

---

## Paso 3 — Instalar en cada máquina de usuario

Ejecutar en la máquina del usuario (requiere privilegios de administrador):

**macOS / Linux:**
```bash
sudo npx @howincodes/claude-code-limiter setup \
  --code CLM-xxx-xxxxxx \
  --server http://IP-DEL-SERVIDOR:3000
```

**Windows (PowerShell como Administrador):**
```powershell
npx @howincodes/claude-code-limiter setup `
  --code CLM-xxx-xxxxxx `
  --server http://IP-DEL-SERVIDOR:3000
```

Reiniciar Claude Code. El usuario queda limitado.

---

## Variables de entorno del servidor

| Variable | Requerida | Default | Descripción |
|----------|-----------|---------|-------------|
| `ADMIN_PASSWORD` | Sí | — | Contraseña del dashboard |
| `PORT` | No | `3000` | Puerto del servidor |
| `JWT_SECRET` | No | auto | Secreto para sesiones. Definir para persistir sesiones entre reinicios |
| `DATA_DIR` | No | `./data` | Ruta de la base de datos SQLite |

---

## Comandos útiles en máquinas de usuario

```bash
# Ver estado y uso actual
npx @howincodes/claude-code-limiter status

# Sincronizar límites con el servidor
sudo npx @howincodes/claude-code-limiter sync

# Desinstalar (requiere autorización del admin en el dashboard)
sudo npx @howincodes/claude-code-limiter uninstall
```

---

## Funcionalidades incluidas

- Límites por modelo (`fable`, `opus`, `sonnet`, `haiku`) con ventanas `daily`, `weekly`, `monthly`, `sliding_24h`
- Presupuesto de créditos unificado (fable=15, opus=10, sonnet=3, haiku=1 por defecto)
- Restricciones horarias por modelo
- Dashboard en tiempo real con WebSocket
- Kill switch remoto + logout forzado
- Pausa y reactivación de usuarios
- **Protección de desinstalación**: el usuario no puede desinstalar sin autorización del admin (toggle en dashboard → User Detail → "Allow self-uninstall")
- **Bypass por cuenta personal**: si el usuario cambia a su cuenta personal de Anthropic, los límites no aplican
- **Control de Agent View / Remote Control**: toggle por usuario (OFF por defecto). El admin activa desde User Detail → "Permitir Agent View / Remote Control"
- **Tracking por versión de modelo**: registra la versión específica usada (ej. `opus-4-6`, `fable-5`), visible en User Detail → "Uso por Versión"
- **Detección de tampering**: alerta en dashboard si el usuario manipula `managed-settings.json`
- **Límites por effort level**: cap del nivel de razonamiento por usuario (low/medium/high/xhigh/max) con multiplicadores de créditos configurables en Settings
- **Control de Workflows / Subagentes**: toggle por usuario + límite numérico para workflows masivos y subagentes
- **Tracking de tokens reales**: registra `input_tokens` y `output_tokens` del transcript de Claude. Permite poner topes de tokens consumidos por ventana
- **Cobertura Claude Code web**: hook de repo stateless para sesiones cloud (claude.ai/code). Generar con `npx @howincodes/claude-code-limiter gen-repo-hook --server <URL> --token <TOKEN>`

---

## Seguridad en Windows

En Windows los permisos de archivo (`icacls`) son parciales. Las capas activas son:

- Watchdog (tarea programada cada 5 min, restaura archivos si son modificados)
- Fail-closed (sin config = bloqueado)
- Tracking server-side (borrar archivos locales no resetea contadores)
- Kill switch remoto

---

## Soporte

Abrir un issue en el repositorio o contactar al administrador del sistema.
