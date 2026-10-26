# Importing a program folder

On the programs dashboard, choose **Import folder**, then select the program root
folder from your computer. The root should contain `project.pros`, a `.v5code`
file, or the program's `src/` and `include/` directories.

The dialog uses the folder name as the suggested program name and detects PROS,
EZ-Template, JAR, or VEXcode from its paths. Confirm or change the program type,
review the included and excluded files, then choose **Import program**. Unknown
folders require you to choose the appropriate program type.

Imported files retain their paths relative to the selected folder and their
original bytes, including empty and binary files. The selected root folder is
not added as an extra directory. No starter files are inserted. Empty directories
are not imported because Git stores files rather than directories.

The preview excludes Git metadata, internal collaboration files, generated build
output, caches, local `.env` files, and compiled files. It also excludes firmware
and managed SDK dependencies for the selected program type. PROS and EZ-Template
imports additionally skip editor and CI settings, compilation databases, local
PROS caches, documentation, and archives or logs in the program root. Custom
source, headers, makefiles, `project.pros`, assets, and licensing notices are kept.
The same rules are enforced by the backend and shown in the preview. Builds use the
versions provided by the existing build image; importing an older program does
not install its original SDK or kernel. Programs that depend on other versions or
additional toolchains may need changes before they compile.

Limits after exclusions are 1,000 files, 16 MiB total, and 384 KiB per file. The
preview reports files that exceed those limits before uploading. A browser with
folder selection support is required. The picker imports a folder directly.

## Upload and retry behavior

Files are uploaded in ordered batches, bounded to 100 files and 384 KiB of
contents per request. The backend checks workspace membership, upload ownership,
paths, duplicate or conflicting paths, exclusions, and cumulative limits. An exact
batch retry is safe; a retry with different bytes is rejected.

The program is added to the dashboard only after all files have uploaded. If an
upload fails before that point, retry from the dialog or select the folder again.
Abandoned staging data expires after 24 hours. The folder remains on the user's
computer and its files are never modified.

Repository setup then commits the uploaded source. If setup fails, the existing
**Retry** action uses the staged folder contents again. It does not seed a starter
template. Failed provisioning retains its staged source for retries. Successful
provisioning removes staging data in scheduled batches and marks repository files
as user files.

Deploy the updated Convex schema and functions with the web app. Folder import
uses the existing Code Storage configuration and needs no additional credentials.
