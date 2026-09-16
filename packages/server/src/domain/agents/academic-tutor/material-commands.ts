import { Effect } from "effect";
import * as AgentCli from "../harness/index.ts";
import { currentFolder, inScope } from "../../folders/folder.ts";
import {
  InvalidPageRange,
  MaterialNotFound,
  parsePageSelection,
  type MaterialRepository
} from "../../materials/material.ts";

const renderMaterialError = (error: MaterialNotFound | InvalidPageRange | { readonly _tag: "MaterialRepositoryError"; readonly reason: unknown }) => {
  switch (error._tag) {
    case "MaterialNotFound":
      return `Material not found: ${error.materialId}`;
    case "InvalidPageRange":
      return `Invalid page selection ${JSON.stringify(error.range)}: ${error.reason}`;
    case "MaterialRepositoryError":
      return `Material repository error: ${String(error.reason)}`;
  }
};

export const makeMaterialCommands = (repository: MaterialRepository) => {
  const list = AgentCli.Command.withExamples([
    { command: "materials list", description: "List all uploaded PDF materials" }
  ])(
    AgentCli.Command.withDescription("List the user's uploaded PDF materials")(
      AgentCli.Command.exec("list", {}, () =>
        Effect.gen(function* () {
          const scope = yield* currentFolder;
          const materials = (yield* repository.list()).filter((material) => inScope(scope, material));
          if (materials.length === 0) {
            return scope === undefined ? "No PDF materials found." : "No PDF materials found in this folder.";
          }

          return materials.map((material) =>
            `- ${material.id}: ${material.title} (${material.pageCount} pages, file: ${material.fileName})`
          ).join("\n");
        }).pipe(
          Effect.catch((error) => Effect.succeed(renderMaterialError(error)))
        )
      )
    )
  );

  const view = AgentCli.Command.withExamples([
    { command: "materials view algebra-notes 10", description: "Render page 10 as an image" },
    { command: "materials view algebra-notes 13-20", description: "Render pages 13 through 20 as images" },
    { command: "materials view algebra-notes 10,13-20", description: "Render page 10 and pages 13 through 20" }
  ])(
    AgentCli.Command.withDescription("Render selected PDF pages as PNG images for visual reading")(
      AgentCli.Command.exec("view", {
        materialId: AgentCli.Argument.string("materialId").pipe(
          AgentCli.Argument.withDescription("Material id from `materials list`")
        ),
        pages: AgentCli.Argument.withMetavar("<pages:10,13-20>")(
          AgentCli.Argument.withDescription("Page selection like 10 or 13-20 or 10,13-20")(
            AgentCli.Argument.string("pages")
          )
        )
      }, ({ materialId, pages }) =>
        Effect.gen(function* () {
          const parsedPages = yield* parsePageSelection(pages);
          // Only the folder's materials can be read: the tutor never reaches another folder's PDF.
          const scope = yield* currentFolder;
          if (scope !== undefined) {
            const material = yield* repository.get(materialId);
            if (!inScope(scope, material)) {
              return `Material ${materialId} is not in this folder. Only the materials listed by \`materials list\` are available in this conversation; tell the student the PDF is in another folder.`;
            }
          }
          return yield* repository.renderPages(materialId, parsedPages);
        }).pipe(
          Effect.catch((error) => Effect.succeed(renderMaterialError(error)))
        )
      )
    )
  );

  return AgentCli.Command.group("materials", [list, view] as const).pipe(
    AgentCli.Command.withDescription("Uploaded PDF material commands")
  );
};
