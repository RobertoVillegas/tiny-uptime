import type { AuthStore } from "./auth-object";
import type { Directory } from "./directory-object";
import type { Probe } from "./probe-object";
import type { Workspace } from "./workspace-object";

export interface Env {
  WORKSPACE: DurableObjectNamespace<Workspace>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  AUTH: DurableObjectNamespace<AuthStore>;
  /** One per region, for monitors checked from several places. */
  PROBE: DurableObjectNamespace<Probe>;
  /** The panel's static files (apps/panel/dist), served under /app. */
  ASSETS?: Fetcher;
  /** Instance operator token: creates workspaces and their first invites. */
  ADMIN_TOKEN?: string;
  /** Slug of the workspace whose status page is served at `/`. */
  PUBLIC_SLUG?: string;
  /** Cloudflare Email Service `send_email` binding for email alert channels; needs a verified sender domain. */
  EMAIL?: SendEmail;
  /** The verified address email alerts are sent from. */
  EMAIL_FROM?: string;
  /** This server's public address; alerts link to the incident in the panel there. */
  APP_URL?: string;
}
