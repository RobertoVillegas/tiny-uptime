import type { Directory } from "./directory";
import type { Workspace } from "./workspace/workspace";

export interface Env {
  WORKSPACE: DurableObjectNamespace<Workspace>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  /** Instance operator token: creates workspaces. */
  ADMIN_TOKEN?: string;
  /** Slug of the workspace whose status page is served at `/`. */
  PUBLIC_SLUG?: string;
}
