# VEX V5 C++ starter template layouts

Research note, 2026-10-23. Source links point to the product maintainers' own documentation or repositories.

## Finding

The four names do not all mean the same kind of template. VEXcode V5 is the platform's C++ project format; JAR-Template is an add-on starter built for VEXcode; PROS is its own kernel and project layout; and EZ-Template is a library plus a PROS example project. Seed the complete upstream starter for JAR, PROS, and EZ so the supporting build and dependency files stay together. For the generic VEXcode choice, use the current VEX VS Code Extension's V5 C++ project layout (`src/main.cpp`), and treat VEXcode's `.v5cpp` import/export file as a package artifact rather than the working source tree. ([VEX VS Code project guide](https://kb.vex.com/hc/en-us/articles/20146074601748-Creating-VS-Code-Projects-for-V5), [VEXcode C++ project guide](https://kb.vex.com/hc/en-us/articles/360051666332-Starting-Downloading-and-Running-a-VEXcode-V5-C-Project))

## Suggested trees

### VEXcode V5 C++

```text
.
├── include/
│   ├── vex.h                # VEX SDK umbrella header
│   └── robot-config.h       # default Brain declaration
└── src/
    ├── main.cpp             # program entry point
    └── robot-config.cpp     # default Brain device
```

The VEX VS Code Extension's project guide says to open `src/main.cpp` for a C/C++ project. This starter adds the SDK umbrella header and a default Brain declaration so that `main.cpp` can include `vex.h`; teams can add their motors, sensors, and controllers to `robot-config.*`. A `.v5cpp` is the documented VEX V5 C/C++ import file type; it is not a replacement for keeping the project's source files in the repository. ([VEX VS Code project guide](https://kb.vex.com/hc/en-us/articles/20146074601748-Creating-VS-Code-Projects-for-V5), [VEXcode C++ project guide](https://kb.vex.com/hc/en-us/articles/360051666332-Starting-Downloading-and-Running-a-VEXcode-V5-C-Project))

### JAR-Template

JAR means **Jackson Area Robotics Template**. The maintainers describe it as a library for VEXcode Pro V5 and the VEX VS Code Extension. Its published project manifest is a VEXcode `.v5code` project and lists these starter files: ([JAR project overview](https://jacksonarearobotics.github.io/JAR-Template/), [JAR-Template.v5code at the upstream repository](https://github.com/JacksonAreaRobotics/JAR-Template/blob/0e8c9ce388fe9fd6bb40ea05c36d9eb71ea2df88/JAR-Template.v5code), [JAR install guide](https://jacksonarearobotics.github.io/JAR-Template/basic-tutorials/installing-jar-template))

```text
.
├── JAR-Template.v5code      # VEXcode Pro project manifest/import metadata
├── makefile
├── vex/
│   ├── mkenv.mk
│   └── mkrules.mk
├── include/
│   ├── vex.h
│   ├── robot-config.h
│   ├── autons.h
│   └── JAR-Template/
│       ├── PID.h
│       ├── drive.h
│       ├── odom.h
│       └── util.h
└── src/
    ├── main.cpp
    ├── robot-config.cpp     # device_config entry in upstream manifest
    ├── autons.cpp
    └── JAR-Template/
        ├── PID.cpp
        ├── drive.cpp
        ├── odom.cpp
        └── util.cpp
```

These are all entries in the upstream manifest, not four optional library files to cherry-pick. Keep the manifest and VEX make support if the repo is meant to round-trip as a JAR/VEXcode Pro project. `robot-config.cpp` is marked as device configuration in that manifest; it is the part most likely to be regenerated or changed when configuring hardware. ([JAR-Template.v5code](https://github.com/JacksonAreaRobotics/JAR-Template/blob/0e8c9ce388fe9fd6bb40ea05c36d9eb71ea2df88/JAR-Template.v5code))

### PROS V5 C++

PROS 3.2 and later default to one `src/main.cpp` for the competition callbacks. The official walkthrough describes the root build metadata and the template-provided API/runtime files. ([PROS project structure](https://pros.cs.purdue.edu/v5/tutorials/general/project-structure.html), [PROS Clawbot walkthrough](https://pros.cs.purdue.edu/v5/tutorials/walkthrough/clawbot.html))

```text
.
├── project.pros            # required by PROS CLI: target/kernel/template metadata
├── Makefile                # required build entry point
├── common.mk               # Makefile helper
├── src/
│   └── main.cpp             # default user program; more .c/.cpp files are optional
├── include/
│   ├── api.h                # PROS API umbrella header
│   ├── main.h               # shared project declarations/includes
│   └── pros/                # PROS API headers copied from the kernel template
└── firmware/                # prebuilt runtime libraries and V5 linker scripts
```

PROS's docs say projects are created by copying the kernel template; `firmware/` contains the PROS library and `include/` contains the API headers. They need to match the selected PROS template/kernel version and should be treated as template-managed files. Custom headers and additional source files are optional. Okapi/display directories and libraries appear when their corresponding templates are installed; they are not requirements of a bare PROS project. ([PROS project structure](https://pros.cs.purdue.edu/v5/tutorials/general/project-structure.html), [PROS walkthrough tree](https://pros.cs.purdue.edu/v5/tutorials/walkthrough/clawbot.html))

### EZ-Template

EZ-Template depends on PROS. Its installation guide directs users to download the EZ-Template example-project archive and identifies `src/main.cpp` as the main user-control/autonomous file. The upstream example archive is a complete PROS project with EZ-Template 3.2.2. ([EZ-Template installation](https://ez-robotics.github.io/EZ-Template/tutorials/installation), [EZ-Template upstream repository and example archive](https://github.com/EZ-Robotics/EZ-Template/tree/2733127f518bcf57558c45390bd9eb59a961ef19))

```text
.
├── project.pros
├── Makefile
├── common.mk
├── firmware/                # PROS/EZ-Template and linked libraries, linker scripts
├── include/
│   ├── api.h
│   ├── main.h               # includes PROS and EZ-Template APIs
│   ├── autons.hpp
│   ├── subsystems.hpp
│   └── EZ-Template/         # pinned EZ-Template headers from the project archive
└── src/
    ├── main.cpp
    └── autons.cpp
```

For an upstream-compatible starter, copy the example archive's full `include/` and `firmware/` trees with these files; do not substitute only `main.cpp` and assume EZ-Template is built into PROS. The current archive also ships `.gitignore` and `.clang-format` (useful, optional project settings), `compile_commands.json` (editor/build tooling output; optional), and `EZ-Template@3.2.2.zip` (the bundled installable template archive; optional after the matching library files are present). The example's drive constructor expects the robot's drive ports, wheel diameter/RPM, and IMU port to be configured; EZ-Template requires an IMU. ([EZ-Template installation](https://ez-robotics.github.io/EZ-Template/tutorials/installation), [upstream example archive](https://github.com/EZ-Robotics/EZ-Template/blob/2733127f518bcf57558c45390bd9eb59a961ef19/EZ-Template-Example-Project.zip))

## Template creation notes

- Pin an upstream template version when copying it. This is especially important for PROS and EZ-Template because the starter contains compiled runtime libraries and API headers.
- Keep generated/editor artifacts out of the default tree unless they are needed by the named IDE workflow. The EZ example's `compile_commands.json` is not robot program source.
- VEXcode Pro JAR and current VEX VS Code C++ are separate formats. The JAR starter includes a `.v5code` project manifest and the current VEX VS Code import docs use `.v5cpp`; do not rename one format to impersonate the other.
