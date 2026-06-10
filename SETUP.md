# Guía de instalación desde cero

## Requisitos

- Git
- Docker Desktop (opción A) o Node.js ≥ 18 (opción B)
- Claude Code instalado en cada máquina de usuario

---

## Paso 1 — Clonar el repositorio (en el servidor)

```bash
git clone https://github.com/rmm-01/claude-code-limiter-con-verificador-uninstall.git
cd claude-code-limiter-con-verificador-uninstall
```

---

## Paso 2 — Levantar el servidor

### Opción A: Docker (recomendado)

```bash
# Construir imagen
docker build -t claude-limiter-local packages/server

# Levantar contenedor
docker run -d \
  --name claude-limiter \
  -p 3000:3000 \
  -v claude-limiter-data:/data \
  -e ADMIN_PASSWORD=tu-password-seguro \
  claude-limiter-local
```

**Windows (PowerShell):**
```powershell
docker build -t claude-limiter-local packages/server

docker run -d `
  --name claude-limiter `
  -p 3000:3000 `
  -v claude-limiter-data:/data `
  -e ADMIN_PASSWORD=tu-password-seguro `
  claude-limiter-local
```

Verificar que funciona:
```bash
curl http://localhost:3000/api/v1/health
# Debe responder: {"status":"ok"}
```

### Opción B: Node.js local

```bash
cd packages/server
npm install
ADMIN_PASSWORD=tu-password-seguro node bin/server.js
```

**Windows (PowerShell):**
```powershell
cd packages\server
npm install
$env:ADMIN_PASSWORD = "tu-password-seguro"
node bin\server.js
```

---

## Paso 3 — Abrir el dashboard

Abrir en el browser:
```
http://localhost:3000/dashboard
```

Iniciar sesión con el `ADMIN_PASSWORD` configurado.

---

## Paso 4 — Crear usuarios

1. Click en **Add User**
2. Completar nombre y slug (ej: `alice`, `dev-team`)
3. Elegir preset de límites o configurar manualmente
4. Click **Create User**
5. Copiar el código de instalación generado (`CLM-xxx-xxxxxx`)

---

## Paso 5 — Instalar en cada máquina de usuario

En la máquina del usuario, clonar el repo y correr el installer:

```bash
# En la máquina del usuario
git clone https://github.com/rmm-01/claude-code-limiter-con-verificador-uninstall.git
cd claude-code-limiter-con-verificador-uninstall/packages/cli
npm install
```

**Linux / macOS:**
```bash
sudo node src/installer.js setup \
  --code CLM-xxx-xxxxxx \
  --server http://IP-DEL-SERVIDOR:3000
```

**Windows (CMD o PowerShell como Administrador):**
```cmd
node src\installer.js setup --code CLM-xxx-xxxxxx --server http://IP-DEL-SERVIDOR:3000
```

> La IP del servidor es la IP de la máquina donde corre Docker, accesible desde la máquina del usuario.
> En VirtualBox con adaptador host-only: usar `192.168.56.1`.

Reiniciar Claude Code. El usuario queda limitado.

---

## Comandos útiles

### Gestión Docker

```bash
# Ver logs
docker logs claude-limiter

# Detener
docker stop claude-limiter

# Eliminar contenedor (los datos persisten en el volumen)
docker rm claude-limiter

# Reconstruir después de cambios en el código
docker stop claude-limiter && docker rm claude-limiter
docker build -t claude-limiter-local packages/server
docker run -d --name claude-limiter -p 3000:3000 -v claude-limiter-data:/data -e ADMIN_PASSWORD=tu-password claude-limiter-local
```

### En máquinas de usuario

```bash
# Ver estado y uso actual
npx @howincodes/claude-code-limiter status

# Forzar sincronización con servidor
sudo node src/installer.js sync   # Linux/macOS
node src\installer.js sync        # Windows admin

# Desinstalar (requiere que el admin habilite allow_self_uninstall en el dashboard)
sudo node src/installer.js uninstall   # Linux/macOS
node src\installer.js uninstall        # Windows admin
```

---

## Variables de entorno del servidor

| Variable | Requerida | Default | Descripción |
|----------|-----------|---------|-------------|
| `ADMIN_PASSWORD` | Sí | `changeme` | Contraseña del dashboard |
| `PORT` | No | `3000` | Puerto del servidor |
| `JWT_SECRET` | No | auto | Definir para persistir sesiones entre reinicios |
| `DATA_DIR` | No | `/data` | Ruta de la base de datos SQLite |

---

## Funcionalidades

- **Límites por modelo**: fable, opus, sonnet, haiku con ventanas daily/weekly/monthly/sliding_24h
- **Presupuesto de créditos**: un budget unificado entre modelos (fable=15, opus=10, sonnet=3, haiku=1)
- **Restricciones horarias**: por modelo y zona horaria
- **Dashboard en tiempo real**: WebSocket con feed de actividad
- **Kill switch**: bloqueo remoto + logout forzado
- **Pausa / reactivación**: suspensión temporal sin revocar acceso
- **Protección de desinstalación**: toggle `Allow self-uninstall` por usuario en el dashboard
- **Bypass por cuenta personal**: si el usuario cambia a su cuenta personal de Anthropic, los límites no aplican
- **Control de Agent View / Remote Control**: toggle por usuario, OFF por defecto
- **Tracking por versión de modelo**: registra versión específica (ej. `opus-4-6`, `fable-5`)
- **Detección de tampering**: alerta si el usuario manipula `managed-settings.json`

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| `dashboard/dist/index.html not found` | Reconstruir imagen con `docker build -t claude-limiter-local packages/server` |
| `Claude Code is not logged in` en setup | Correr `claude auth login` en la misma sesión de administrador |
| VM no alcanza el servidor | Verificar con `Invoke-WebRequest http://IP:3000/api/v1/health -UseBasicParsing` |
| Código de instalación ya usado | Generar nuevo desde User Detail → "Generate Install Code" |
| `allow_self_uninstall` bloqueado | Habilitar en Dashboard → User Detail → toggle "Allow self-uninstall" |
| Agent View / Remote Control deshabilitado | Habilitar en Dashboard → User Detail → toggle "Permitir Agent View / Remote Control" |
