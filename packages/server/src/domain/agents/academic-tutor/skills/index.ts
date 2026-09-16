export { UseUploadedMaterialsSkill } from "./use-uploaded-materials.ts";
export { CreateStudyArtifactsSkill } from "./create-study-artifacts.ts";
export { TeachVisuallySkill, makeTeachVisuallySkill, teachVisuallyExamples, type TeachVisuallyOptions } from "./teach-visually.ts";
export { AssessExplanationsSkill, makeAssessExplanationsSkill, assessExplanationsExample, type AssessExplanationsOptions } from "./assess-explanations.ts";

import { UseUploadedMaterialsSkill } from "./use-uploaded-materials.ts";
import { CreateStudyArtifactsSkill } from "./create-study-artifacts.ts";
import { makeTeachVisuallySkill, type TeachVisuallyOptions } from "./teach-visually.ts";
import { makeAssessExplanationsSkill, type AssessExplanationsOptions } from "./assess-explanations.ts";

export type AcademicTutorSkillOptions = TeachVisuallyOptions & Partial<AssessExplanationsOptions>;

/** The tutor's skills, composed with the product options that change their rules. */
export const makeAcademicTutorSkills = (options: AcademicTutorSkillOptions) => [
  UseUploadedMaterialsSkill,
  CreateStudyArtifactsSkill,
  makeTeachVisuallySkill(options),
  makeAssessExplanationsSkill({ autoExplain: options.autoExplain ?? false })
] as const;

export const AcademicTutorSkills = makeAcademicTutorSkills({ autoDiagram: true });
