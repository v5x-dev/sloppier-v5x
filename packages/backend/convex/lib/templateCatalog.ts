export const programTemplates = [
  {
    id: "vexcode",
    label: "VEXCode",
    description: "A blank V5 C++ program for the VEX VS Code Extension.",
  },
  {
    id: "jar",
    label: "JAR",
    description: "Jackson Area Robotics' VEXcode V5 starter program.",
  },
  {
    id: "pros",
    label: "PROS",
    description: "A V5 program with the PROS 4.1.1 kernel.",
  },
  {
    id: "ez-template",
    label: "EZ",
    description: "A V5 program with PROS, EZ-Template, and example subsystems.",
  },
] as const

export type ProgramTemplate = (typeof programTemplates)[number]["id"]
