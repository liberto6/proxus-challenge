# Proxus Product Engineer Challenge

Template de inicio para explorar un caso fullstack + AI inspirado en Proxus: un tutor académico que usa materiales PDF, crea artefactos de estudio (notas, quizzes, tests, esquemas y objetivos de explicación anclados a las páginas) y permite resolver quizzes/tests, explorar esquemas y explicar un tema con las propias palabras para que se corrija punto por punto desde una UI web.

El objetivo del repo no es ser una app cerrada, sino una base razonable para que una persona candidata pueda demostrar criterio de producto, arquitectura fullstack y uso pragmático de AI.

## Stack

- Monorepo con `pnpm` workspaces.
- Runtime backend: Node.js.
- Backend: TypeScript, Effect v4 beta, Effect HTTP API, Gemini.
- Frontend: React 19, Vite, Tailwind v4, `@effect/atom-react`.
- Contratos compartidos: `packages/shared`.
- Persistencia local simple: filesystem bajo `packages/server/.data` (`.data` está ignorado por git).
- PDFs: Poppler (`pdfinfo`, `pdftoppm`) para renderizar páginas que Gemini puede analizar como imágenes.

## Estructura

```txt
packages/
  shared/      # Contratos HTTP y schemas compartidos (única fuente de artefactos, eventos, sesiones)
  server/      # Backend Node + Effect
    src/domain/     # tutor (harness, skills, comandos, anclaje, trazas), artefactos, materiales
    src/infra/      # adaptadores: ficheros JSON, Poppler, Gemini
    src/transport/  # HTTP API, stream NDJSON, OpenAPI
    src/scripts/    # CLI del tutor y demos
    src/evals/      # evals deterministas (sin API) y en vivo (opt-in)
    fixtures/       # PDF sintético para evals
  web/         # App React + proxy /api hacia el backend
  ai-google/   # Integración local con Gemini para Effect AI (no usada por el server)

scripts/
  check-architecture.mjs  # verifica la regla de capas (pnpm run check:architecture)

docs/
  getting-started.md  # Cómo orientarse en la repo y añadir PDFs locales
  architecture.md     # Mapa de arquitectura actual
  development.md      # Setup, scripts y troubleshooting
  effect-primer.md    # Lectura rápida de Effect para este repo
  ai-agent.md         # Cómo funciona el tutor/agent harness
  decisions.md        # Decisiones de arquitectura y sus motivos
  api.md              # Endpoints principales
  testing.md          # Checks y QA manual
  data.md             # Datos locales y storage
  resources.md        # Referencias externas sobre Effect, AI agents y evals
```

## Quickstart

Requisitos:

- Node.js 20+.
- pnpm instalado.
- Poppler instalado (`pdfinfo` y `pdftoppm`) si quieres usar PDFs.
- Una API key de Google Gemini para probar el agente AI. Con el nivel gratuito, cada modelo tiene un límite diario y por minuto de peticiones (en el momento de escribir esto, 20 al día y 5 por minuto en los modelos Flash); un turno que lee páginas de un PDF consume 3 o 4 peticiones. El modelo se elige con `GEMINI_MODEL` en `.env` (por defecto `gemini-3.5-flash`). Si el proveedor rechaza una petición, la interfaz lo indica y el log del servidor lo traza.

Instala dependencias:

```bash
pnpm install
```

Configura entorno:

```bash
cp .env.example .env
# edita GOOGLE_GENERATIVE_AI_API_KEY
```

Arranca backend + frontend:

```bash
pnpm run dev
```

URLs por defecto:

- Web: <http://localhost:5173>
- API: <http://localhost:3000>
- Docs OpenAPI/Scalar: <http://localhost:3000/docs>
- OpenAPI JSON: <http://localhost:3000/openapi.json>

## Comandos útiles

```bash
pnpm run typecheck
pnpm run check:architecture
pnpm --filter @proxus/web run build

# evals sin API
pnpm --filter @proxus/server run eval:tutor:tool-calls
pnpm --filter @proxus/server run eval:tutor:grounding
pnpm --filter @proxus/server run eval:tutor:sessions
pnpm --filter @proxus/server run eval:materials
pnpm --filter @proxus/server run eval:tutor:diagram
pnpm --filter @proxus/server run eval:tutor:explain
pnpm --filter @proxus/server run eval:folders
pnpm --filter @proxus/web run check:layout

# CLI del tutor (consume API)
pnpm --filter @proxus/server run agent:tutor "list my uploaded materials"
pnpm --filter @proxus/server run agent:tutor "Crea un quiz corto de una pregunta"
```

## Por dónde empezar si estás evaluando el proyecto

1. Lee [`CHALLENGE.md`](./CHALLENGE.md) para entender el contexto y cómo enfocar una mejora.
2. Lee [`docs/getting-started.md`](./docs/getting-started.md) para orientarte y añadir PDFs locales.
3. Lee [`docs/architecture.md`](./docs/architecture.md) para ubicarte en paquetes y capas.
4. Si Effect no te resulta familiar, lee [`docs/effect-primer.md`](./docs/effect-primer.md) y [`docs/resources.md`](./docs/resources.md).
5. Ejecuta `pnpm run dev` y prueba el flujo:
   - crea una carpeta para el tema (o usa General) y sube un PDF desde la barra lateral (por ejemplo `packages/server/fixtures/materials/ciclo-del-agua.pdf`); el tutor solo verá los PDF de la carpeta abierta,
   - pide al tutor que te explique unas páginas citándolas: verás qué páginas lee mientras trabaja,
   - pide un quiz sobre esas páginas y ábrelo desde el botón que aparece en el chat,
   - resuélvelo, revisa las correcciones y pregúntale al tutor por una pregunta con el quiz abierto,
   - pide que te explique las fases del ciclo: el tutor decide dibujar un esquema; ábrelo, toca un concepto, salta a la página que lo explica y pregúntale por él,
   - di «quiero explicártelo yo»: el tutor fija los puntos clave que debes cubrir (sin mostrarte la solución); en el panel, graba (dictado simulado en este prototipo) o escribe tu explicación y corrígela: cada punto queda cubierto, a medias, falta o incorrecto, con lo esperado en los que no cubriste y la página que lo explica; pregúntale al tutor por un punto y repite,
   - recarga la página: la carpeta y la conversación se conservan; las conversaciones de la carpeta se listan y se reabren desde la barra.
6. Si necesitas más detalle sobre storage local, sigue [`docs/data.md`](./docs/data.md); no subas `.data`.
7. Las decisiones que explican el diseño actual están en [`docs/decisions.md`](./docs/decisions.md).
8. Antes de entregar cambios, ejecuta [`docs/testing.md`](./docs/testing.md).

## Limitaciones conocidas

- La guardia de anclaje solo detecta citas explícitas de página ("página 2", "págs. 1-3"); una afirmación inventada sin número de página no se detecta.
- Los esquemas se validan en estructura, contenido mínimo y anclaje (ids, aristas, subetiquetas, causas, tarjetas, páginas leídas), no en la fidelidad de cada texto al PDF; el layout propio no minimiza cruces y se limita a 16 conceptos.
- La corrección de respuesta corta compara texto normalizado, no significado.
- Los objetivos de explicación se corrigen por cobertura de ideas (palabras sin acentos, con plurales y los sinónimos que declara el tutor), no por significado: una buena paráfrasis que no use ninguna de las formas declaradas sale como «falta». Un juez con rúbrica queda como siguiente paso; esta corrección sería su respaldo.
- El dictado es simulado: el micro reproduce una muestra generada en el servidor a partir de las soluciones (buena / a medias / floja) en lugar de reconocer la voz. El hook tiene la interfaz que tendría uno real; el endpoint de muestras es de demostración y expone las soluciones a quien lo llame.
- La ruta de streaming del chat es manual (fuera de Effect HTTP API), como en la base original.
- Con la cuota gratuita de Gemini, un turno con lectura de páginas consume 3 o 4 peticiones; ante cuota diaria agotada el tutor lo dice y no reintenta.
- Sin multiusuario: carpetas, sesiones, materiales y artefactos son ficheros locales sin propietario.
- Un PDF pertenece a una sola carpeta y no se mueve ni se copia desde la interfaz; para usarlo en otra carpeta se sube de nuevo.

## Nota sobre runtime y package manager

El monorepo se instala y se orquesta con `pnpm`. El server corre en Node usando `tsx` para ejecutar TypeScript en desarrollo; la web corre con Vite.
