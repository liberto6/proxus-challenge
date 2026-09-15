Default to the Node.js + pnpm workflow for this repo.

- Use `pnpm install` from the root.
- Use `pnpm run <script>` from the root, or `pnpm --filter <package> run <script>` for package scripts.
- Server TypeScript entrypoints run on Node via `node --env-file=../../.env --import tsx ...`.
- Frontend dev/build uses Vite.
- Do not use Bun-specific APIs (`Bun.serve`, `Bun.file`, `bun:*`, `bun build`) in new code.

## Architecture

The repo is a pnpm monorepo with a ports-and-adapters (hexagonal) server. Two dependency rules apply, and `pnpm run check:architecture` enforces both from import statements:

```txt
web -> shared <- server          (packages)
transport -> domain <- infra     (packages/server/src)
```

- `packages/shared`: HTTP contracts and schemas. Depends on nothing else in the repo.
- `packages/web`: React UI. Depends only on `shared`.
- `packages/server/src/domain`: product rules (tutor harness, artifacts, materials, grading) and the **ports** it needs, declared as Effect services (`MaterialRepository`, `ArtifactRepository`, `SessionRepository`, `PdfService`). Must not import `infra`, `transport` or `@effect/platform-node`.
- `packages/server/src/infra`: **adapters** that implement the ports with concrete technology (filesystem JSON, Poppler, Gemini HTTP). May depend on `domain`.
- `packages/server/src/transport`: HTTP routes, streaming and OpenAPI. Composes the `Layer`s in `transport/http/server.ts`. May depend on `domain` and `infra`.

Where a new piece goes:

- **New endpoint**: contract in `packages/shared/src/api/*` → handler in `transport/http/handlers.ts` → logic in `domain`. The web consumes it through `packages/web/src/api-client`.
- **New port + adapter**: interface and `Context.Service` in `domain/<area>/*` → implementation in `infra/<area>/*` → wired in `transport/http/server.ts` (and in any CLI entrypoint that composes layers).
- **New agent capability**: a `Command` in `domain/agents/academic-tutor/*-commands.ts` (the only way the model reaches the domain) and, if the model needs guidance, an `AgentSkill` in `domain/agents/academic-tutor/skills/`. Do not add tools to the harness toolkit; keep `load_skill` + `cli`.
- **New artifact kind**: schema in `packages/shared/src/schemas/artifact.ts`, grading/validation in `domain/artifacts`, rendering in `packages/web/src/components`.
- **Anything Node-specific** (files, processes, network clients) belongs in `infra` behind a port.

Run `pnpm run check:architecture` before finishing a change. Known exceptions are listed in `scripts/check-architecture.mjs` with the reason and the change that removes them.

## APIs

- Server HTTP is composed with Effect HTTP API and `@effect/platform-node`.
- Prefer Effect platform services (`FileSystem`, `Path`, `ChildProcessSpawner`) at infrastructure boundaries.
- Use native `fetch`, `WebSocket`, and standard Node APIs where appropriate.
- Keep HTTP contracts in `packages/shared`.

## Testing / checks

Use the existing scripts:

```sh
pnpm run typecheck
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run typecheck
```

## Frontend

- React app lives in `packages/web/src`.
- Vite config lives in `packages/web/vite.config.ts`.
- Tailwind output is generated into `packages/web/src/styles.generated.css` by package scripts.

## AI / local config

- `.env` lives at repo root.
- `GOOGLE_GENERATIVE_AI_API_KEY` is required for the server to start.
- Poppler commands `pdfinfo` and `pdftoppm` are required for the server to start.
- Local runtime data lives under `packages/server/.data` and must not be committed.
