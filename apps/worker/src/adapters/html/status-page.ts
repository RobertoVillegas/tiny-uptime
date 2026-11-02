import type { PublicMonitor } from "@tiny-uptime/contracts";

const HOUR = 3_600_000;

export function renderStatusPage(title: string, monitors: PublicMonitor[], now: number): string {
  const down = monitors.filter((m) => m.status === "down").length;
  const headline = down === 0 ? "All systems operational" : `${down} ${down === 1 ? "service" : "services"} down`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--up:#16a34a;--down:#dc2626;--none:#d6d3d1;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--none:#44403c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:720px;margin:0 auto;padding:48px 16px}
h1{font-size:22px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 32px;font-size:13px}
.row{padding:16px 0;border-top:1px solid var(--line)}
.top{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.name{font-weight:600}
.meta{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums;text-align:right}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;background:var(--none)}
.up .dot{background:var(--up)}.down .dot{background:var(--down)}
.bars{display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin-top:10px}
.bars span{height:24px;border-radius:2px;background:var(--none)}
.bars .ok{background:var(--up)}.bars .bad{background:var(--down)}.bars .mixed{background:#f59e0b}
</style>
</head>
<body>
<main>
<h1>${headline}</h1>
<p class="sub">Updated ${new Date(now).toISOString().slice(11, 16)} UTC · last 24 hours</p>
${monitors.map((m) => row(m, now)).join("\n")}
</main>
</body>
</html>`;
}

function row(m: PublicMonitor, now: number): string {
  const uptime = m.uptime24h === null ? "—" : `${(m.uptime24h * 100).toFixed(2)}%`;
  const latency = m.lastMs === null ? "" : ` · ${m.lastMs} ms`;
  return `<div class="row ${m.status}">
<div class="top"><span class="name"><span class="dot"></span>${escape(m.name)}</span><span class="meta">${uptime}${latency}</span></div>
<div class="bars">${bars(m, now)}</div>
</div>`;
}

function bars(m: PublicMonitor, now: number): string {
  const byHour = new Map(m.hours.map((h) => [h.hour, h]));
  const current = Math.floor(now / HOUR) * HOUR;
  const out: string[] = [];
  for (let i = 23; i >= 0; i--) {
    const hour = current - i * HOUR;
    const h = byHour.get(hour);
    const cls = !h ? "" : h.ok === h.checks ? "ok" : h.ok === 0 ? "bad" : "mixed";
    const label = h ? `${new Date(hour).toISOString().slice(11, 16)} UTC: ${h.ok}/${h.checks} ok` : "no data";
    out.push(`<span class="${cls}" title="${label}"></span>`);
  }
  return out.join("");
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
