import { currentWorkspaceId } from "../../lib/api";
import { authedRoute } from "../../router";
import { PageHeader } from "../shell/page-header";
import { ApiKeysSection } from "./api-keys-section";
import { MembersSection } from "./members-section";

export function SettingsPage() {
  const { me } = authedRoute.useRouteContext();
  const membership = me.memberships.find((m) => m.workspaceId === currentWorkspaceId());
  if (!membership) return null;
  const owner = membership.role === "owner";
  return (
    <>
      <PageHeader
        title="Settings"
        description={`${membership.workspaceName} · you are ${membership.role === "owner" ? "an owner" : `a ${membership.role}`}.`}
      />
      <div className="flex flex-col gap-6">
        <MembersSection workspaceId={membership.workspaceId} canManage={owner} myUserId={me.userId} />
        {owner ? <ApiKeysSection /> : null}
      </div>
    </>
  );
}
