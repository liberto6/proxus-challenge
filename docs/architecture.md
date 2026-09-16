# Arquitectura

## Vista general

```mermaid
flowchart LR
  subgraph Browser["Browser"]
    Web["React + Vite"]
    Atoms["@effect/atom-react"]
  end

  subgraph Server["Node + Effect Server"]
    direction LR

    subgraph Transport["Transport"]
      Http["HTTP API (materials, artifacts, sessions)"]
      Stream["NDJSON stream: AgentEvent"]
      Handlers["HTTP Handlers"]
    end

    subgraph Domain["Domain"]
      Tutor["TutorChatService"]
      Harness["Agent harness: session, grounding, trace, events"]
      Materials["Materials Domain"]
      Artifacts["Artifacts Domain"]
    end

    subgraph Infra["Infrastructure adapters"]
      GeminiAdapter["Gemini adapter (function calling, retries)"]
      PopplerService["PopplerPdfService"]
      FileMaterials["FileMaterialRepository (upload, delete)"]
      FileArtifacts["FileArtifactRepository"]
      FileSessions["FileSessionRepository"]
    end
  end

  subgraph External["External"]
    Gemini["Google Gemini"]
    Poppler["Poppler CLI"]
  end

  subgraph Storage["Local .data"]
    PDFs["materials/pdfs/*.pdf + *.meta.json"]
    ArtifactJson["artifacts/*.json"]
    Attempts["attempts/*.json"]
    Sessions["agent-sessions/*.json"]
  end

  Web --> Atoms
  Atoms -->|"HTTP"| Http
  Web -->|"sessionId + input"| Stream
  Http --> Handlers
  Stream --> Tutor
  Handlers --> Tutor
  Handlers --> Materials
  Handlers --> Artifacts
  Handlers --> FileSessions
  Tutor --> Harness
  Tutor --> FileSessions
  Harness --> Materials
  Harness --> Artifacts

  Harness --> GeminiAdapter
  Materials --> FileMaterials
  Materials --> PopplerService
  Artifacts --> FileArtifacts

  GeminiAdapter --> Gemini
  PopplerService --> Poppler
  FileMaterials --> PDFs
  FileArtifacts --> ArtifactJson
  FileArtifacts --> Attempts
  FileSessions --> Sessions
```

El repo está organizado como monorepo `pnpm`:

- `packages/shared`: contratos de API y schemas compartidos.
- `packages/server`: dominio, infraestructura y transporte HTTP.
- `packages/web`: UI React y estado cliente.
- `packages/ai-google`: integración local de Google AI para Effect.

## Dirección de dependencias

```mermaid
flowchart TD
  Web["packages/web"] --> Shared["packages/shared"]
  Server["packages/server"] --> Shared
  Server --> AiGoogle["packages/ai-google"]

  Shared -. "no depende de" .-> Web
  Shared -. "no depende de" .-> Server
```

`shared` no debería depender de `server` ni de `web`. Es la capa que evita que el contrato HTTP se duplique manualmente en ambos lados.

## Shared: contratos y schemas

Archivos principales:

- `packages/shared/src/api/Api.ts`
- `packages/shared/src/api/tutor.ts`
- `packages/shared/src/api/materials.ts`
- `packages/shared/src/api/artifacts.ts`
- `packages/shared/src/schemas/*`

Aquí se definen endpoints con Effect HTTP API y schemas con `Schema`. El server los implementa y la web los consume.

## Server: transporte, dominio e infraestructura

El backend intenta separar tres responsabilidades:

- **Transporte**: HTTP, streaming, OpenAPI y adaptación request/response.
- **Dominio**: reglas de negocio, contratos internos, agente, artifacts y materiales.
- **Infraestructura**: implementaciones concretas contra filesystem, Poppler, Node y proveedores externos.

```mermaid
flowchart TB
  Entry["src/index.ts"] --> Composition["transport/http/server.ts\nLayer composition"]

  subgraph Transport["Transport layer"]
    HttpServer["transport/http/server.ts"]
    Handlers["transport/http/handlers.ts"]
    StreamRoute["/api/tutor/chat/stream (AgentEvent NDJSON)"]
  end

  subgraph Domain["Domain layer"]
    TutorService["domain/agents/academic-tutor\nTutorChatService + ui-context"]
    Harness["domain/agents/harness\nsession / grounding / trace / event / cli / skills"]
    MaterialsDomain["domain/materials\nMaterialRepository / PdfService ports"]
    ArtifactsDomain["domain/artifacts\nports + grading (schemas en shared)"]
  end

  subgraph Infra["Infrastructure layer"]
    Gemini["infra/agents\ngemini-language-model.ts"]
    FileSessions["infra/agents\nfile-session-repository.ts"]
    FileMaterials["infra/materials\nfile-material-repository.ts"]
    Poppler["infra/materials\npoppler-pdf-service.ts"]
    FileArtifacts["infra/artifacts\nfile-artifact-repository.ts"]
    NodePlatform["@effect/platform-node"]
  end

  subgraph Outside["Fuera de las capas"]
    Scripts["src/scripts/* (CLI)"]
    Evals["src/evals/* (evals)"]
    Check["scripts/check-architecture.mjs"]
  end

  subgraph External["External systems"]
    Google["Google Gemini API"]
    PopplerCli["pdfinfo / pdftoppm"]
    Data["packages/server/.data"]
  end

  Composition --> Transport
  Composition --> Domain
  Composition --> Infra

  Handlers --> TutorService
  Handlers --> MaterialsDomain
  Handlers --> ArtifactsDomain
  StreamRoute --> TutorService
  TutorService --> Harness
  TutorService --> FileSessions
  Harness --> MaterialsDomain
  Harness --> ArtifactsDomain

  Gemini --> Google
  FileMaterials --> Data
  FileMaterials --> Poppler
  Poppler --> PopplerCli
  FileArtifacts --> Data
  FileSessions --> Data
  Infra --> NodePlatform
  Scripts --> Domain
  Scripts --> Infra
  Evals --> Domain
  Evals --> Infra
```

### Transporte

Archivos principales:

- `packages/server/src/index.ts`: arranca el runtime Node y lanza el server.
- `packages/server/src/transport/http/server.ts`: compone rutas, docs, stream NDJSON y layers.
- `packages/server/src/transport/http/handlers.ts`: implementa los endpoints definidos en `packages/shared`.

Esta capa debería saber de HTTP, schemas compartidos y serialización, pero no debería contener reglas de negocio complejas.

### Dominio

Archivos principales:

- `packages/server/src/domain/agents/*`
- `packages/server/src/domain/agents/harness/*`
- `packages/server/src/domain/artifacts/*`
- `packages/server/src/domain/materials/*`

Aquí viven los conceptos del producto: tutor, sesiones, skills, commands, materials, artifacts, attempts y grading. También se definen puertos como `MaterialRepository`, `ArtifactRepository` o `PdfService`.

El dominio debería depender de interfaces/servicios, no de detalles como filesystem, Poppler o HTTP.

### Infraestructura

Archivos principales:

- `packages/server/src/infra/agents/file-session-repository.ts`
- `packages/server/src/infra/artifacts/file-artifact-repository.ts`
- `packages/server/src/infra/materials/file-material-repository.ts`
- `packages/server/src/infra/materials/poppler-pdf-service.ts`
- `packages/server/src/infra/agents/gemini-language-model.ts`

Esta capa implementa los puertos del dominio usando tecnología concreta: archivos JSON, PDFs locales, comandos Poppler, Gemini y servicios de Node.

El adapter de Gemini vive en `infra/agents/gemini-language-model.ts`: traduce el prompt de Effect AI (incluidas las partes `tool-call` y `tool-result`) al formato de function calling de Gemini y declara las tools a partir de su JSON Schema.

Los entrypoints CLI (`src/scripts/*`) y los evals (`src/evals/*`) componen capas, así que viven fuera de `domain`. La regla de dependencias se comprueba con `pnpm run check:architecture` (ver `AGENTS.md`).

### Regla práctica

```txt
transport -> domain <- infra
```

- Transporte llama al dominio.
- Infraestructura implementa puertos que el dominio necesita.
- El dominio no debería importar transporte ni implementaciones concretas de infraestructura.

La composición de dependencias vive principalmente en `transport/http/server.ts`, usando `Layer` de Effect y `@effect/platform-node`.

## Tutor agent

El tutor está implementado como un harness de agente con dos herramientas:

- `load_skill`: carga instrucciones especializadas.
- `cli`: ejecuta comandos permitidos del dominio (`materials …`, `artifacts …`); no es una shell.

Las skills no se exponen como tools directas; el modelo debe cargarlas mediante `load_skill`. Alrededor del bucle hay tres piezas de código (no de prompt): la guardia de anclaje (solo se citan páginas renderizadas), las trazas por turno y el sink de eventos con el que las tools informan de progreso. Detalle en [`ai-agent.md`](./ai-agent.md); motivos en [`decisions.md`](./decisions.md).

```mermaid
sequenceDiagram
  participant User
  participant Web as React Chat
  participant API as /api/tutor/chat/stream
  participant Tutor as TutorChatService
  participant Sessions as FileSessionRepository
  participant Harness as AgentSession
  participant Gemini
  participant CLI as Domain CLI tools
  participant Data as .data

  User->>Web: asks for a quiz (quiz open in the panel)
  Web->>API: POST { sessionId, input, context }
  API->>Tutor: streamMessage
  Tutor->>Sessions: getSession(sessionId)
  Sessions-->>Tutor: stored history
  Tutor->>Harness: stream(history + input + UI note)
  Harness->>Gemini: prompt (native tool-call parts) + tools
  Gemini-->>Harness: functionCall(load_skill / cli)
  Harness-->>API: progress "Leyendo páginas 1-2 de …"
  Harness->>CLI: execute command
  CLI->>Data: read/write materials/artifacts
  Data-->>CLI: result
  CLI-->>Harness: tool result (traced)
  Harness->>Gemini: functionResponse
  Gemini-->>Harness: final answer
  Harness->>Harness: grounding check (cited pages were rendered?)
  Harness-->>API: message events (user, tool-call, tool-result, assistant)
  Tutor->>Sessions: appendMessages (only if the turn completed)
  API-->>Web: NDJSON events … done
```

Puntos de entrada:

- `packages/server/src/domain/agents/academic-tutor.ts`
- `packages/server/src/domain/agents/academic-tutor/tutor-chat-service.ts`
- `packages/server/src/domain/agents/harness/session.ts`

## Web: estado y UI

Entrada:

- `packages/web/src/App.tsx`

Componentes principales:

- `packages/web/src/components/Sidebar.tsx`
- `packages/web/src/components/Chat.tsx`
- `packages/web/src/components/ArtifactWorkspace.tsx`

Estado remoto con Effect Atom:

- `packages/web/src/domain/materials/atoms.ts`
- `packages/web/src/domain/artifacts/atoms.ts`
- `packages/web/src/domain/tutor/atoms.ts`

Streaming tutor:

- `packages/web/src/domain/tutor/stream.ts`

La UI mantiene estado local para cosas efímeras como input del chat, artifact seleccionado y respuestas del formulario.

## Trade-offs actuales

- Persistencia por filesystem (materiales, artefactos, intentos, sesiones): simple y fácil de inspeccionar, sin concurrencia ni multiusuario.
- La ruta del stream del chat es manual (NDJSON) fuera de Effect HTTP API; el resto de rutas usan Effect HTTP API con contratos en `shared`.
- Los schemas de artefactos viven solo en `shared` (`schemas/artifact.ts`, con el registro `ArtifactByKind`); el dominio los importa y añade validación y corrección. Añadir un tipo de artefacto es añadir una entrada al registro y su render en la web.
- El adapter de Gemini es propio (fetch + function calling) en lugar de una librería oficial: pequeño y bajo control, pero hay que mantenerlo (firmas de pensamiento, cuotas).
- La guardia de anclaje es determinista y solo ve citas explícitas de página; no sustituye a una evaluación semántica.
- La regla de capas se comprueba con `pnpm run check:architecture`; los scripts CLI y los evals viven fuera de `domain`.
