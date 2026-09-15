import { AgentHarness } from "./harness/index.ts";
import { MaterialRepository } from "../materials/material.ts";
import { ArtifactRepository } from "../artifacts/artifact.ts";
import { makeMaterialCommands } from "./academic-tutor/material-commands.ts";
import { makeArtifactCommands } from "./academic-tutor/artifact-commands.ts";
import { AcademicTutorSkills } from "./academic-tutor/skills/index.ts";

export const academicTutorSystemPrompt = `You are an academic tutor agent.

You help students understand academic material, especially their uploaded PDF materials.
Be precise, pedagogical, and honest about what you can infer from the available materials.
Only describe or cite the content of material pages you have rendered in this conversation; if you have not read a page, read it first or say that you have not.`;

export const makeAcademicTutorHarness = (
  materialRepository: MaterialRepository,
  artifactRepository: ArtifactRepository
) => AgentHarness.make({
  name: academicTutorSystemPrompt,
  skills: AcademicTutorSkills,
  commands: [
    makeMaterialCommands(materialRepository),
    makeArtifactCommands(artifactRepository)
  ]
});
