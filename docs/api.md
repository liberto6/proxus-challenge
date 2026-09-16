# API

La API principal se define en `packages/shared/src/api/*` con Effect HTTP API.

En local:

- Docs interactivas: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

## Endpoints

### Carpetas

```http
GET    /api/folders/              # todas, General primera
POST   /api/folders/              # { title } -> Folder; 400 título vacío, 409 FolderTitleTaken
PATCH  /api/folders/:id           # { title }; 404, 409
DELETE /api/folders/:id           # 204; 404; 409 FolderNotEmpty { materials, sessions, artifacts }
```

Una carpeta agrupa materiales, conversaciones y práctica. La pertenencia va en cada elemento (`folderId` opcional en `PdfMaterial`, `AgentSession`, `Artifact` y sus resúmenes); sin `folderId` el elemento está en **General** (`general`), que existe siempre, se puede renombrar y no se borra. Los listados aceptan `?folderId=`. Borrar una carpeta se rechaza mientras tenga PDF, conversaciones con mensajes o artefactos (las conversaciones vacías se eliminan con ella). No hay mover ni copiar entre carpetas: un PDF pertenece a una carpeta.

### Tutor

```http
POST   /api/tutor/sessions        # { folderId? } crea una sesión vacía en esa carpeta (General si falta)
GET    /api/tutor/sessions        # lista resúmenes (id, fechas, nº mensajes, primer mensaje, carpeta); ?folderId=
GET    /api/tutor/sessions/:id    # sesión con todos sus mensajes
DELETE /api/tutor/sessions/:id    # borra la conversación
POST   /api/tutor/chat            # un turno, respuesta completa
POST   /api/tutor/chat/stream     # un turno, eventos NDJSON
```

El tutor trabaja dentro de la carpeta de la sesión: `materials list` y `artifacts list` solo devuelven lo de esa carpeta, y `materials view` de un PDF de otra carpeta se rechaza. El cliente no envía la carpeta en cada turno; el servidor la toma de la sesión.

La conversación se guarda en el servidor (`.data/agent-sessions/<id>.json`). Cada turno envía `{ sessionId, input, maxSteps?, context? }`, donde `context` indica qué artefacto (y pregunta o nodo de un diagrama) tiene abierto el alumno para que el tutor pueda referirse a ello sin preguntar; se inyecta como nota de sistema de ese turno y no se persiste. Cada turno: el servidor carga el historial, ejecuta el turno y persiste sus mensajes al terminar. Un turno que acaba en `error` no persiste nada, así que reintentar no duplica el mensaje del alumno. La web solo recuerda el `sessionId` en `localStorage`.

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
GET    /api/materials/          # lista; ?folderId= filtra
GET    /api/materials/:id
GET    /api/materials/:id/pages/:page   # una página renderizada (PNG como data URI); 404 sin material, 400 fuera de rango
POST   /api/materials/          # multipart: file (PDF, máx. 20 MB), title y folderId opcionales -> PdfMaterial
DELETE /api/materials/:id       # 404 si no existe
```

Los materiales representan PDFs disponibles para el tutor. El server puede renderizar páginas vía Poppler para que Gemini las procese como imágenes.

La subida valida cabecera PDF y que Poppler pueda leerlo (400 si no). El id se deriva del título (slug más sufijo corto), por ejemplo `ciclo-del-agua-a1b2c3`; el título se guarda en `<id>.meta.json` junto al PDF. Los PDFs copiados a mano sin sidecar siguen funcionando con su nombre de fichero como id y título, y aparecen en la carpeta General.

### Artifacts

```http
GET /api/artifacts/             # ?kind= y ?folderId= filtran
GET /api/artifacts/:id
POST /api/artifacts/:id/submit
```

`submit` crea y corrige un intento, devolviendo un attempt con estado `graded` cuando aplica.

## Tipos de artifact

Todo artifact puede llevar `source: { materialId, pages }` (de qué material y páginas se generó) y `createdAt`; los intentos llevan `createdAt`. Ambos son opcionales para que los ficheros anteriores sigan siendo válidos.

- `note`: contenido markdown.
- `quiz`: preguntas cerradas.
- `test`: preguntas cerradas o `short-answer`.
- `diagram`: resumen visual. `diagramType` es `process` (pasos ordenados en `mainPath`, `cyclic` si se cierra), `concept-map` (`rootId` y aristas etiquetadas) o `timeline` (pasos en `mainPath`, `phases` en orden y `phase` en cada paso). Cada nodo lleva `id`, `label`, `sublabel` (una línea visible en la caja), `kind` (`step`, `concept`, `agent`, `condition`, `quantity`, `formula` con su `formula`, `definition`, `example`), `description` y `pages`. Una arista entre dos pasos consecutivos es la transición y su `label` es la causa. `groups` (nodos que van juntos), `cards` (claves, definiciones y fórmulas, fechas: lo que no cabe en cajas, con sus páginas) y `views` (subconjuntos con nota) son opcionales; los campos v2 son opcionales en el schema para que los diagramas guardados antes sigan decodificando, y el validador exige lo que cada tipo necesita al crear. `source` es obligatorio. Límites en `diagramLimits` (3-16 nodos, 32 aristas, subetiquetas de 8-60 caracteres, hasta 3 tarjetas de 2-5 ítems). Los diagramas no admiten intentos.

```json
{
  "kind": "diagram",
  "title": "El ciclo del agua: fases",
  "diagramType": "process",
  "summary": "Las cuatro fases se encadenan en un bucle.",
  "source": { "materialId": "ciclo-del-agua-a1b2c3", "pages": [1, 2] },
  "nodes": [
    { "id": "evaporacion", "label": "Evaporación", "sublabel": "líquido → vapor por el calor del sol", "kind": "step", "description": "El calor del sol convierte el agua en vapor que sube a la atmósfera.", "pages": [1] },
    { "id": "condensacion", "label": "Condensación", "sublabel": "vapor → gotas; forma las nubes", "kind": "step", "description": "El vapor se enfría en altura y forma nubes de gotas diminutas.", "pages": [1] },
    { "id": "precipitacion", "label": "Precipitación", "sublabel": "las gotas caen como lluvia, nieve o granizo", "kind": "step", "description": "Las gotas crecen y caen como lluvia, nieve o granizo.", "pages": [2] },
    { "id": "plantas", "label": "Plantas", "sublabel": "aportan vapor por transpiración", "kind": "agent", "description": "Las plantas liberan vapor que se suma al de la evaporación.", "pages": [2] }
  ],
  "mainPath": ["evaporacion", "condensacion", "precipitacion"],
  "cyclic": true,
  "edges": [
    { "from": "evaporacion", "to": "condensacion", "label": "el vapor se enfría en altura" },
    { "from": "condensacion", "to": "precipitacion", "label": "las gotas crecen y pesan" },
    { "from": "precipitacion", "to": "evaporacion", "label": "el agua vuelve a calentarse" },
    { "from": "plantas", "to": "condensacion", "label": "aportan vapor" }
  ],
  "cards": [{ "title": "Fechas", "items": ["Perrault (1674)", "Mariotte (1686)"], "pages": [3] }]
}
```

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
