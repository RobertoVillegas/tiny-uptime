import type { Membership, OAuthScope } from "@tiny-uptime/contracts";
import { esc } from "./escape";

const CSS = `
:root{color-scheme:light dark;--bg:oklch(.985 .002 255);--surface:oklch(1 0 0);--fg:oklch(.22 .012 255);--muted:oklch(.5 .014 255);--line:oklch(.22 .012 255/.1);--accent:oklch(.22 .012 255);--on-accent:oklch(.985 .002 255);--warn:oklch(.55 .13 75)}
@media (prefers-color-scheme:dark){:root{--bg:oklch(.17 .006 255);--surface:oklch(.205 .007 255);--fg:oklch(.95 .004 255);--muted:oklch(.7 .012 255);--line:oklch(.29 .008 255);--accent:oklch(.95 .004 255);--on-accent:oklch(.17 .006 255);--warn:oklch(.78 .11 75)}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:1rem;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:26rem;background:var(--surface);border:1px solid var(--line);border-radius:.75rem;padding:1.5rem;display:flex;flex-direction:column;gap:1.25rem}
h1{font-size:1.125rem;margin:0;text-wrap:balance}
p{margin:0;text-wrap:pretty}
.muted{color:var(--muted)}.small{font-size:.8125rem}
fieldset{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}
legend{font-weight:600;font-size:.875rem;margin-bottom:.5rem;padding:0}
label.option{display:flex;gap:.625rem;align-items:flex-start;padding:.625rem .75rem;border:1px solid var(--line);border-radius:.5rem;cursor:pointer}
label.option:has(input:checked){border-color:var(--fg)}
input[type=radio]{margin:.25rem 0 0;accent-color:var(--accent)}
.option span{display:flex;flex-direction:column}
.warn{color:var(--warn)}
.actions{display:flex;gap:.5rem;justify-content:flex-end}
button{font:inherit;font-weight:500;font-size:.875rem;min-height:2.5rem;padding:0 1rem;border-radius:.5rem;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--fg)}
button.primary{background:var(--accent);color:var(--on-accent);border-color:transparent}
button:focus-visible,input:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
code{font-size:.8125rem;word-break:break-all}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

export type ConsentView = {
  clientName: string;
  redirectHost: string;
  email: string;
  workspaces: Membership[];
  wantsWrite: boolean;
  /** The original query, echoed back in hidden fields so the POST re-checks the same request. */
  params: Record<string, string>;
};

export function renderConsent(view: ConsentView): string {
  const hidden = Object.entries(view.params)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join("");
  const workspaces = view.workspaces
    .map(
      (w, i) =>
        `<label class="option"><input type="radio" name="workspace" value="${esc(w.workspaceId)}"${i === 0 ? " checked" : ""}><span><b>${esc(w.workspaceName)}</b><span class="muted small">${w.role === "viewer" ? "You can only read here" : `You are ${w.role === "owner" ? "an owner" : "an editor"}`}</span></span></label>`,
    )
    .join("");
  const access: { scope: OAuthScope[]; label: string; hint: string }[] = [
    ...(view.wantsWrite
      ? [
          {
            scope: ["mcp:read", "mcp:write"] as OAuthScope[],
            label: "Read and change",
            hint: "Create, pause and delete monitors, acknowledge incidents, post updates",
          },
        ]
      : []),
    { scope: ["mcp:read"], label: "Read only", hint: "See monitors, incidents, uptime and maintenance" },
  ];
  const accessOptions = access
    .map(
      (a, i) =>
        `<label class="option"><input type="radio" name="scope" value="${a.scope.join(" ")}"${i === 0 ? " checked" : ""}><span><b>${a.label}</b><span class="muted small">${a.hint}</span></span></label>`,
    )
    .join("");
  return page(
    `Connect ${view.clientName}`,
    `<h1>Connect ${esc(view.clientName)} to tiny-uptime?</h1>
<p>It will act as you, <b>${esc(view.email)}</b>, and send you back to <code>${esc(view.redirectHost)}</code>.</p>
<p class="small warn">Apps name themselves. Only connect one you just started.</p>
<form method="post" action="/oauth/authorize">${hidden}
<fieldset><legend>Workspace</legend>${workspaces}</fieldset>
<fieldset style="margin-top:1.25rem"><legend>Access</legend>${accessOptions}<p class="small muted">Read and change never exceeds your role. Disconnect any time from your account page.</p></fieldset>
<div class="actions" style="margin-top:1.25rem"><button type="submit" name="decision" value="deny">Cancel</button><button type="submit" name="decision" value="allow" class="primary">Connect</button></div>
</form>`,
  );
}

export function renderOAuthError(message: string): string {
  return page(
    "Cannot connect",
    `<h1>This app cannot connect</h1><p>${esc(message)}</p><p class="small muted">Close this tab and try connecting again from the app.</p>`,
  );
}
