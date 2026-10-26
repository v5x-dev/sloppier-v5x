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
import type * as codeStorage from "../codeStorage.js";
import type * as crdt from "../crdt.js";
import type * as files from "../files.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_buildDependencies from "../lib/buildDependencies.js";
import type * as lib_crdtBackup from "../lib/crdtBackup.js";
import type * as lib_history from "../lib/history.js";
import type * as lib_paths from "../lib/paths.js";
import type * as lib_templateCatalog from "../lib/templateCatalog.js";
import type * as lib_templates from "../lib/templates.js";
import type * as presence from "../presence.js";
import type * as projects from "../projects.js";
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
  codeStorage: typeof codeStorage;
  crdt: typeof crdt;
  files: typeof files;
  "lib/auth": typeof lib_auth;
  "lib/buildDependencies": typeof lib_buildDependencies;
  "lib/crdtBackup": typeof lib_crdtBackup;
  "lib/history": typeof lib_history;
  "lib/paths": typeof lib_paths;
  "lib/templateCatalog": typeof lib_templateCatalog;
  "lib/templates": typeof lib_templates;
  presence: typeof presence;
  projects: typeof projects;
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
