import { Effect, Layer, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as AgentCli from "./cli.ts";
import type { AgentSkill } from "./skill.ts";
import { traceToolCall } from "./trace.ts";
import { emitProgress, progressLabelFor } from "./event.ts";

const LoadSkill = Tool.make("load_skill", {
  description: "Load the full instructions for a listed skill by name.",
  parameters: Schema.Struct({
    name: Schema.String
  }),
  success: Schema.String
});

const Cli = Tool.make("cli", {
  description: "Run one of the tutor's own commands (`materials ...`, `artifacts ...`). This is not a shell: no system commands exist. Use `<command> --help` to inspect usage, subcommands, and examples. Call it only when the request needs data or actions on the user's materials or artifacts.",
  parameters: Schema.Struct({
    input: Schema.String
  }),
  success: Schema.Unknown,
  failure: Schema.String,
  failureMode: "return"
});

export const AgentToolkit = Toolkit.make(LoadSkill, Cli);

export type AgentToolkit = typeof AgentToolkit;

export interface AgentHarness {
  readonly name: string;
  readonly toolkit: AgentToolkit;
  readonly layer: Layer.Layer<Tool.HandlersFor<AgentToolkit["tools"]>>;
  readonly systemPrompt: string;
  readonly skills: readonly AgentSkill[];
  readonly commands: readonly AgentCli.Command[];
  readonly loadSkill: (name: string) => Effect.Effect<string>;
}

export const AgentHarness = {
  make: (spec: {
    readonly name: string;
    readonly skills: readonly AgentSkill[];
    readonly commands?: readonly AgentCli.Command[];
  }): AgentHarness => {
    const commands = spec.commands ?? [];
    const findSkill = (name: string) => spec.skills.find((skill) => skill.name === name);

    const loadSkill = (name: string) =>
      Effect.succeed(
        findSkill(name)?.content ?? unknownSkillHelp(name, spec.skills)
      );

    const systemPrompt = `${spec.name}

You have a \`cli\` tool that runs only these command groups: ${commands.map((command) => command.name).join(", ")}. It is not a shell. Use \`<command> --help\` when you need usage, subcommands, or examples. Call tools only when the request needs data or actions on the user's materials or artifacts; otherwise answer directly.

Available skills:
${skillsHelp(spec.skills)}

You initially only know skill names and short descriptions.
Skills are not tools and their names are not callable functions.
When a task matches a skill description, call the load_skill tool with the skill name, for example { "name": "use-uploaded-materials" }.
Skill text may describe workflows, conventions, examples, or tools available elsewhere in the harness.`;

    return {
      name: spec.name,
      toolkit: AgentToolkit,
      layer: AgentToolkit.toLayer({
        load_skill: ({ name }) => traced("load_skill", { name }, loadSkill(name)),
        cli: ({ input }) => traced("cli", { input }, AgentCli.execute(commands, input).pipe(
          Effect.mapError(AgentCli.renderError)
        ))
      }),
      systemPrompt,
      skills: spec.skills,
      commands,
      loadSkill
    };
  }
};

/** Executes a tool handler and emits one trace line with its duration and outcome. */
const traced = <A, E, R>(tool: string, input: unknown, handler: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* emitProgress(progressLabelFor(tool, input));
    const startedAt = Date.now();
    const exit = yield* Effect.exit(handler);
    const durationMs = Date.now() - startedAt;
    yield* traceToolCall({ tool, input, durationMs, isFailure: exit._tag === "Failure" });
    return yield* exit;
  });

const skillsHelp = (skills: readonly AgentSkill[]) =>
  skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");

const unknownSkillHelp = (name: string, skills: readonly AgentSkill[]) =>
  `Unknown skill: ${name}\n\nAvailable skills:\n${skillsHelp(skills)}`;
