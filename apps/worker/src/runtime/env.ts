import type { AuthStore } from "./auth-object";
import type { Directory } from "./directory-object";
import type { Workspace } from "./workspace-object";

export interface Env {
  WORKSPACE: DurableObjectNamespace<Workspace>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  AUTH: DurableObjectNamespace<AuthStore>;
  /** Instance operator token: creates workspaces and their first invites. */
  ADMIN_TOKEN?: string;
  /** Slug of the workspace whose status page is served at `/`. */
  PUBLIC_SLUG?: string;
}
