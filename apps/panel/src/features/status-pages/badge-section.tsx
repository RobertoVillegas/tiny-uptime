import type { StatusPage } from "@tiny-uptime/contracts";
import { CopyButton } from "@tiny-uptime/ui/components/copy-button";
import { Section } from "@tiny-uptime/ui/components/surface";

/**
 * Snippets that embed the page's live status badge, linking to the page at its public address
 * (the custom domain when there is one). The preview loads from this origin, which the panel's
 * CSP allows; a custom domain may not be live yet.
 */
export function BadgeSection({ page }: { page: StatusPage }) {
  const badge = `${page.url.replace(/\/$/, "")}/badge.svg`;
  const alt = `${page.title} status`;
  const snippets = [
    { name: "Markdown", text: `[![${markdownText(alt)}](${markdownUrl(badge)})](${markdownUrl(page.url)})` },
    { name: "HTML", text: `<a href="${html(page.url)}"><img src="${html(badge)}" alt="${html(alt)}"></a>` },
  ];
  return (
    <Section
      title="Status badge"
      description="Shows the page's current status in a README or on your site. Add ?label=… to the image URL to change the left side."
    >
      <div className="flex flex-col gap-4 p-5">
        <img src={`/s/${page.slug}/badge.svg`} alt={alt} className="h-5 self-start" />
        {snippets.map((s) => (
          <div key={s.name} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-small font-medium">{s.name}</span>
              <CopyButton text={s.text} variant="ghost" label={`Copy ${s.name}`} />
            </div>
            <code className="block rounded-control bg-subtle px-3 py-2.5 font-mono text-small break-all">{s.text}</code>
          </div>
        ))}
      </div>
    </Section>
  );
}

function html(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function markdownText(text: string): string {
  return text.replace(/[\\[\]`*_<>]/g, (c) => `\\${c}`);
}

function markdownUrl(url: string): string {
  return url.replace(/[()<> ]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
