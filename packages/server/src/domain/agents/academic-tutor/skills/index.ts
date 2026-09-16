export { UseUploadedMaterialsSkill } from "./use-uploaded-materials.ts";
export { CreateStudyArtifactsSkill } from "./create-study-artifacts.ts";
export { TeachVisuallySkill, makeTeachVisuallySkill, teachVisuallyExamples, type TeachVisuallyOptions } from "./teach-visually.ts";

import { UseUploadedMaterialsSkill } from "./use-uploaded-materials.ts";
import { CreateStudyArtifactsSkill } from "./create-study-artifacts.ts";
import { makeTeachVisuallySkill, type TeachVisuallyOptions } from "./teach-visually.ts";

/** The tutor's skills, composed with the product options that change their rules. */
export const makeAcademicTutorSkills = (options: TeachVisuallyOptions) => [
  UseUploadedMaterialsSkill,
  CreateStudyArtifactsSkill,
  makeTeachVisuallySkill(options)
] as const;

export const AcademicTutorSkills = makeAcademicTutorSkills({ autoDiagram: true });
