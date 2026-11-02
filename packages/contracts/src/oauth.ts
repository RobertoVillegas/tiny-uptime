import * as v from "valibot";

/** What an MCP client may do: read only, or read and change. Write never exceeds the member's role. */
export const OAUTH_SCOPES = ["mcp:read", "mcp:write"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/** Dynamic client registration (RFC 7591), public clients only: PKCE stands in for a client secret. */
export const ClientRegistrationInput = v.object({
  client_name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)), "MCP client"),
  redirect_uris: v.pipe(v.array(v.pipe(v.string(), v.maxLength(500))), v.minLength(1), v.maxLength(10)),
  token_endpoint_auth_method: v.optional(v.literal("none"), "none"),
  grant_types: v.optional(v.array(v.picklist(["authorization_code", "refresh_token"]))),
  response_types: v.optional(v.array(v.literal("code"))),
  client_uri: v.optional(v.string()),
  logo_uri: v.optional(v.string()),
  scope: v.optional(v.string()),
  software_id: v.optional(v.string()),
  software_version: v.optional(v.string()),
});
export type ClientRegistrationInput = v.InferOutput<typeof ClientRegistrationInput>;

/** An app a user connected to a workspace, as the account page lists it. */
export type OAuthGrantDto = {
  id: string;
  clientName: string;
  workspaceId: string;
  workspaceName: string;
  scopes: OAuthScope[];
  createdAt: string;
  lastUsedAt: string | null;
};
