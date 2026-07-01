# claude-code-limiter — React Dashboard

Dashboard moderno para el administrador de claude-code-limiter. Construido con React + TypeScript + Vite + Tailwind CSS.

## Stack

- **React 19** + TypeScript
- **Vite** para dev server y builds
- **Tailwind CSS** para estilos
- **WebSocket** para actualizaciones en tiempo real

## Páginas

- **Overview** — todos los usuarios con barras de uso, créditos, feed de actividad en vivo
- **User Detail** — desglose por usuario: gauge de créditos, barras por modelo, tendencias mensuales, editor de límites
- **Add User** — crear usuario, configurar límites, copiar código de instalación
- **Settings** — pesos de créditos, multiplicadores de effort, nombre del equipo, contraseña
- **Analytics** — distribución de modelos, horas pico, usuarios activos por día

## Controles por usuario

- **Status**: active / paused / killed (kill switch con logout remoto)
- **Allow self-uninstall**: toggle para permitir/denegar desinstalación
- **Allow agents**: toggle para Agent View / Remote Control
- **Allow workflows**: toggle para habilitar/deshabilitar workflows y subagentes
- **Max effort level**: selector de nivel máximo de razonamiento (low/medium/high/xhigh/max)

## Tipos de límite configurables

- Cap por modelo (diario/semanal/mensual/sliding 24h)
- Presupuesto de créditos
- Restricciones horarias por modelo
- Límite de subagentes/workflows
- Límite de tokens (input + output)

## Desarrollo

```bash
cd packages/dashboard
npm install
npm run dev
```

El dashboard se conecta al servidor en `http://localhost:3000` por defecto. Configurar `VITE_API_URL` para apuntar a otro servidor.

## Build

```bash
npm run build
```

Los archivos de producción se generan en `dist/`.
