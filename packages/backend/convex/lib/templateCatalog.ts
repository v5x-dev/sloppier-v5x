export const programTemplates = [
  {
    id: "vexcode",
    label: "VEXCode",
    description: "A blank V5 C++ project for the VEX VS Code Extension.",
  },
  {
    id: "jar",
    label: "JAR",
    description: "Jackson Area Robotics' VEXcode V5 starter project.",
  },
  {
    id: "pros",
    label: "PROS",
    description: "A PROS 4.1.1 kernel project.",
  },
  {
    id: "ez-template",
    label: "EZ",
    description: "A PROS project with EZ-Template and example subsystems.",
  },
] as const

export type ProgramTemplate = (typeof programTemplates)[number]["id"]
