/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as backups from "../backups.js";
import type * as buildConnection from "../buildConnection.js";
import type * as buildWorker from "../buildWorker.js";
import type * as builds from "../builds.js";
import type * as checkpoints from "../checkpoints.js";
import type * as codeStorage from "../codeStorage.js";
import type * as crdt from "../crdt.js";
import type * as diagnostics from "../diagnostics.js";
import type * as files from "../files.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_buildDependencies from "../lib/buildDependencies.js";
import type * as lib_codeStorage_history from "../lib/codeStorage/history.js";
import type * as lib_codeStorage_live from "../lib/codeStorage/live.js";
import type * as lib_codeStorage_provision from "../lib/codeStorage/provision.js";
import type * as lib_codeStorage_repository from "../lib/codeStorage/repository.js";
import type * as lib_codeStorage_search from "../lib/codeStorage/search.js";
import type * as lib_codeStorage_source from "../lib/codeStorage/source.js";
import type * as lib_crdtBackup from "../lib/crdtBackup.js";
import type * as lib_folderImport from "../lib/folderImport.js";
import type * as lib_history from "../lib/history.js";
import type * as lib_liveReplay from "../lib/liveReplay.js";
import type * as lib_paths from "../lib/paths.js";
import type * as lib_programSearch from "../lib/programSearch.js";
import type * as lib_templateCatalog from "../lib/templateCatalog.js";
import type * as lib_templates from "../lib/templates.js";
import type * as presence from "../presence.js";
import type * as programs from "../programs.js";
import type * as search from "../search.js";
import type * as uploads from "../uploads.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  backups: typeof backups;
  buildConnection: typeof buildConnection;
  buildWorker: typeof buildWorker;
  builds: typeof builds;
  checkpoints: typeof checkpoints;
  codeStorage: typeof codeStorage;
  crdt: typeof crdt;
  diagnostics: typeof diagnostics;
  files: typeof files;
  "lib/auth": typeof lib_auth;
  "lib/buildDependencies": typeof lib_buildDependencies;
  "lib/codeStorage/history": typeof lib_codeStorage_history;
  "lib/codeStorage/live": typeof lib_codeStorage_live;
  "lib/codeStorage/provision": typeof lib_codeStorage_provision;
  "lib/codeStorage/repository": typeof lib_codeStorage_repository;
  "lib/codeStorage/search": typeof lib_codeStorage_search;
  "lib/codeStorage/source": typeof lib_codeStorage_source;
  "lib/crdtBackup": typeof lib_crdtBackup;
  "lib/folderImport": typeof lib_folderImport;
  "lib/history": typeof lib_history;
  "lib/liveReplay": typeof lib_liveReplay;
  "lib/paths": typeof lib_paths;
  "lib/programSearch": typeof lib_programSearch;
  "lib/templateCatalog": typeof lib_templateCatalog;
  "lib/templates": typeof lib_templates;
  presence: typeof presence;
  programs: typeof programs;
  search: typeof search;
  uploads: typeof uploads;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
};
