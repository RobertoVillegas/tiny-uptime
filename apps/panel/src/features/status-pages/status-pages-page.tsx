import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@tiny-uptime/ui/components/button";
import { EmptyState, Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { ExternalLink, Globe, Plus } from "lucide-react";
import { statusPagesQuery } from "../../lib/queries";
import { PageHeader } from "../shell/page-header";

export function StatusPagesPage() {
  const pages = useQuery(statusPagesQuery());
  const list = pages.data ?? [];
  return (
    <>
      <PageHeader
        title="Status pages"
        description="Public pages that show how your services are doing, with incidents and maintenance."
        actions={
          <Link to="/status-pages/$pageId" params={{ pageId: "new" }} className={buttonVariants({ variant: "primary" })}>
            <Plus />
            New status page
          </Link>
        }
      />
      <Section>
        {pages.isPending ? (
          <div className="p-5">
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Globe />}
            title="No status pages yet"
            description="Publish one so customers can check your status without asking. It shows only the monitors you pick, never their URLs."
            action={
              <Link to="/status-pages/$pageId" params={{ pageId: "new" }} className={buttonVariants({ variant: "primary" })}>
                <Plus />
                Create a status page
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Link
                  to="/status-pages/$pageId"
                  params={{ pageId: p.id }}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 hover:underline hover:underline-offset-4"
                >
                  <span className="truncate font-medium">{p.title}</span>
                  <span className="truncate text-[0.8125rem] text-muted-foreground">
                    {p.components.length} {p.components.length === 1 ? "monitor" : "monitors"} · {p.url.replace(/^https?:\/\//, "")}
                  </span>
                </Link>
                <a href={p.url} target="_blank" rel="noopener" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  <ExternalLink />
                  Open
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
