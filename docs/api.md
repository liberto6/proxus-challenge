# API

La API principal se define en `packages/shared/src/api/*` con Effect HTTP API.

En local:

- Docs interactivas: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

## Endpoints

### Tutor

```http
POST /api/tutor/sessions          # crea una sesión vacía
GET  /api/tutor/sessions          # lista resúmenes (id, fechas, nº mensajes, primer mensaje)
GET  /api/tutor/sessions/:id      # sesión con todos sus mensajes
POST /api/tutor/chat              # un turno, respuesta completa
POST /api/tutor/chat/stream       # un turno, eventos NDJSON
```

La conversación se guarda en el servidor (`.data/agent-sessions/<id>.json`). Cada turno envía `{ sessionId, input, maxSteps?, context? }`, donde `context` indica qué artefacto (y pregunta) tiene abierto el alumno para que el tutor pueda referirse a ello sin preguntar; se inyecta como nota de sistema de ese turno y no se persiste. Cada turno: el servidor carga el historial, ejecuta el turno y persiste sus mensajes al terminar. Un turno que acaba en `error` no persiste nada, así que reintentar no duplica el mensaje del alumno. La web solo recuerda el `sessionId` en `localStorage`.

`/stream` devuelve NDJSON con eventos `AgentEvent` (`packages/shared/src/schemas/agent-event.ts`):

```json
{ "type": "message", "message": { "role": "user | assistant | tool-call | tool-result" } }
{ "type": "progress", "label": "Leyendo páginas 1-2 de ciclo-del-agua" }
{ "type": "error", "message": "...", "retryable": true }
{ "type": "done" }
```

`message` son los mensajes persistibles de la conversación; `progress` es transitorio (qué está haciendo el tutor ahora); `error` cierra el turno sin respuesta del tutor y la web ofrece reintentar. Cerrar la conexión cancela el turno.

La ruta streaming está implementada manualmente para soportar eventos incrementales.

### Materials

```http
GET    /api/materials/          # lista
GET    /api/materials/:id
POST   /api/materials/          # multipart: file (PDF, máx. 20 MB) y title opcional -> PdfMaterial
DELETE /api/materials/:id       # 404 si no existe
```

Los materiales representan PDFs disponibles para el tutor. El server puede renderizar páginas vía Poppler para que Gemini las procese como imágenes.

La subida valida cabecera PDF y que Poppler pueda leerlo (400 si no). El id se deriva del título (slug más sufijo corto), por ejemplo `ciclo-del-agua-a1b2c3`; el título se guarda en `<id>.meta.json` junto al PDF. Los PDFs copiados a mano sin sidecar siguen funcionando con su nombre de fichero como id y título.

### Artifacts

```http
GET /api/artifacts/
GET /api/artifacts/:id
POST /api/artifacts/:id/submit
```

`submit` crea y corrige un intento, devolviendo un attempt con estado `graded` cuando aplica.

## Tipos de artifact

Todo artifact puede llevar `source: { materialId, pages }` (de qué material y páginas se generó) y `createdAt`; los intentos llevan `createdAt`. Ambos son opcionales para que los ficheros anteriores sigan siendo válidos.

- `note`: contenido markdown.
- `quiz`: preguntas cerradas.
- `test`: preguntas cerradas o `short-answer`.

Tipos de pregunta:

- `multiple-choice`
- `true-false`
- `short-answer` solo para tests.

Formato correcto para multiple choice:

```json
{
  "type": "multiple-choice",
  "options": [
    { "id": "a", "text": "Respuesta A" },
    { "id": "b", "text": "Respuesta B" }
  ]
}
```

El CLI tolera options como strings y las normaliza, pero el contrato estable usa `{ id, text }`.

## Cliente web

- Cliente API: `packages/web/src/api/client.ts`
- Runtime Effect: `packages/web/src/lib/runtime.ts`
- Streaming tutor: `packages/web/src/domain/tutor/stream.ts`
