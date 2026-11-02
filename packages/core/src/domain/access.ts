import type { Role } from "@tiny-uptime/contracts";

export type Action = "read" | "write" | "manage-api-keys" | "manage-members";

/** Who calls the workspace: an API key (full access once verified) or a signed-in member with a role. */
export type Principal = { kind: "key"; keyHash: string } | { kind: "member"; userId: string; role: Role };

const GRANTS: Record<Role, readonly Action[]> = {
  owner: ["read", "write", "manage-api-keys", "manage-members"],
  editor: ["read", "write"],
  viewer: ["read"],
};

export function roleAllows(role: Role, action: Action): boolean {
  return GRANTS[role].includes(action);
}

export function deniedMessage(action: Action): string {
  switch (action) {
    case "read":
      return "you cannot see this workspace";
    case "write":
      return "viewers cannot make changes";
    case "manage-api-keys":
      return "only owners manage API keys";
    case "manage-members":
      return "only owners manage members";
  }
}
