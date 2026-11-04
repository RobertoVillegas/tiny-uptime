/** Styles for the public status page, inlined so the page is one request. Same OKLCH tokens as the panel. */
import { HISTORY_RANGES, HOURLY_UP_TO_DAYS } from "@tiny-uptime/contracts";

/**
 * How many of a range's `bars` a phone shows: all of a short range, else the latest half, in whole
 * days for hourly bars so the "days ago" label stays round.
 */
export function phoneBars(days: number, bars: number): number {
  if (bars <= 45) return bars;
  return days <= HOURLY_UP_TO_DAYS ? Math.max(1, Math.floor(days / 2)) * 24 : Math.ceil(bars / 2);
}

/** How many bars at each end pin their tooltip to that edge. */
const edge = (count: number) => Math.max(1, Math.ceil(count * 0.15));

/**
 * Per range: thinner gaps as bars multiply, tooltips pinned to the edge for the outer bars so they
 * stay on screen, and on phones only the latest bars.
 */
function rangeRules(): string {
  return HISTORY_RANGES.map((days) => {
    const n = days <= HOURLY_UP_TO_DAYS ? days * 24 : days;
    const r = `.bars.r${days}`;
    const gap = n <= 90 ? "" : `${r}{gap:${n <= 200 ? "1px" : "0"}}${r} .bar{border-radius:${n <= 200 ? "1px" : "0"}}`;
    const tips = (count: number) =>
      `${r} .bar:nth-child(-n+${edge(count)}) .tip{left:0;right:auto;transform:none}${r} .bar:nth-last-child(-n+${edge(count)}) .tip{left:auto;right:0;transform:none}`;
    const phone = phoneBars(days, n);
    const narrow =
      phone < n
        ? `@media (max-width:40rem){${r}{grid-template-columns:repeat(${phone},1fr)}${r} .bar:nth-child(-n+${n - phone}){display:none}${r} .bar:nth-child(-n+${n - phone + edge(phone)}) .tip{left:0;right:auto;transform:none}}`
        : "";
    return gap + tips(n) + narrow;
  }).join("\n");
}

export const STATUS_PAGE_CSS = `
:root{color-scheme:light;--bg:oklch(.985 .002 255);--surface:oklch(1 0 0);--fg:oklch(.22 .012 255);--muted:oklch(.5 .014 255);--line:oklch(.22 .012 255/.1);--none:oklch(.93 .005 255);--up:oklch(.63 .15 150);--warn:oklch(.74 .14 75);--down:oklch(.58 .2 25);--info:oklch(.6 .15 255)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;--bg:oklch(.17 .006 255);--surface:oklch(.205 .007 255);--fg:oklch(.95 .004 255);--muted:oklch(.7 .012 255);--line:oklch(.29 .008 255);--none:oklch(.27 .008 255);--up:oklch(.7 .12 150);--warn:oklch(.78 .11 75);--down:oklch(.65 .16 25);--info:oklch(.68 .12 255)}}
:root[data-theme=dark]{color-scheme:dark;--bg:oklch(.17 .006 255);--surface:oklch(.205 .007 255);--fg:oklch(.95 .004 255);--muted:oklch(.7 .012 255);--line:oklch(.29 .008 255);--none:oklch(.27 .008 255);--up:oklch(.7 .12 150);--warn:oklch(.78 .11 75);--down:oklch(.65 .16 25);--info:oklch(.68 .12 255)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:52rem;margin:0 auto;padding:3rem 1rem 4rem;display:flex;flex-direction:column;gap:1.5rem}
h1{font-size:1.5rem;letter-spacing:-.01em;margin:0}
h2{font-size:.8125rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:0 0 .75rem}
h3{font-size:.9375rem;margin:0}
p{margin:0}
.muted{color:var(--muted)}.small{font-size:.8125rem}.num{font-variant-numeric:tabular-nums}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}
.top p{margin-top:.25rem;max-width:65ch;text-wrap:pretty}
.link{color:var(--fg);font-weight:500;font-size:.875rem;white-space:nowrap}
.banner{display:flex;align-items:center;gap:.625rem;padding:1rem 1.25rem;border-radius:.75rem;font-weight:600;background:var(--surface);border:1px solid var(--line)}
.banner .dot{width:.625rem;height:.625rem;border-radius:50%;background:var(--tone)}
.banner.up{--tone:var(--up)}.banner.warn{--tone:var(--warn)}.banner.down{--tone:var(--down)}.banner.info{--tone:var(--info)}
.banner.down{background:color-mix(in oklch,var(--down) 10%,var(--surface));border-color:color-mix(in oklch,var(--down) 35%,transparent)}
.group{background:var(--surface);border:1px solid var(--line);border-radius:.75rem;padding:1.25rem}
.components{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.5rem}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:1rem}
.row.small{margin-top:.375rem}
.row.small>span{white-space:nowrap}
.name{font-weight:500}
.state{font-size:.8125rem;font-weight:600}
.state.up{color:var(--up)}.state.degraded,.state.pending{color:var(--warn)}.state.down{color:var(--down)}.state.paused{color:var(--muted)}
.bars{display:grid;grid-template-columns:repeat(var(--n,90),1fr);gap:2px;height:2.25rem;margin-top:.625rem}
.narrow{display:none}
@media (max-width:40rem){.wide{display:none}.narrow{display:inline}}
.pickers{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.25rem .75rem;margin-bottom:-.75rem}
.pickers:has(+.zone-note){margin-bottom:0}
.ranges{display:flex;gap:.25rem}
.ranges a{color:var(--muted);font-size:.8125rem;text-decoration:none;padding:.25rem .625rem;border-radius:999px;border:1px solid transparent}
.ranges a:hover{color:var(--fg)}
.zone-note{text-align:right;margin:.25rem 0 -.75rem}
.ranges a[aria-current]{color:var(--fg);background:var(--surface);border-color:var(--line);font-weight:500}
@media (max-width:40rem){.pickers{flex-direction:column;align-items:stretch}.ranges{justify-content:space-between;gap:0}.ranges.zones{justify-content:flex-start;gap:.25rem}.ranges a{padding:.25rem .4rem;font-size:.75rem;white-space:nowrap}}
.counts{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem}
.counts li{background:var(--surface);border:1px solid var(--line);border-radius:.75rem;padding:.75rem;text-align:center;font-size:.8125rem;color:var(--muted);display:flex;flex-direction:column;gap:.125rem}
.counts b{font-size:1.5rem;font-weight:600;color:var(--fg)}
.counts li:not([class]) b{color:var(--muted);font-weight:500}
@media (max-width:40rem){.counts{grid-template-columns:repeat(2,1fr)}}
.group>summary{display:flex;align-items:center;justify-content:space-between;gap:.75rem;cursor:pointer;list-style:none;margin:-.25rem 0;padding:.25rem 0}
.group>summary::-webkit-details-marker{display:none}
.group>summary h2{margin:0;display:flex;align-items:center;gap:.375rem;line-height:1}
.chevron{width:1rem;height:1rem;flex:none;margin-left:-.125rem;transition:transform .15s ease-out}
.group[open] .chevron{transform:rotate(90deg)}
.group[open]>summary{margin-bottom:.5rem}
@media (prefers-reduced-motion:reduce){.chevron{transition:none}}
.bar{display:block;position:relative;border-radius:2px;background:var(--none);outline-offset:2px;-webkit-tap-highlight-color:transparent}
.bar.up{background:var(--up)}.bar.warn{background:var(--warn)}.bar.down{background:var(--down)}
.bar:focus-visible{opacity:.75}
.bars:has([aria-current]) .bar:not([aria-current]){opacity:.45}
.bar[aria-current]{outline:2px solid var(--fg);outline-offset:1px;z-index:1}
.tip{display:none;position:absolute;bottom:calc(100% + .5rem);left:50%;transform:translateX(-50%);z-index:2;width:max-content;max-width:14rem;padding:.5rem .625rem;border-radius:.5rem;background:var(--fg);color:var(--bg);font-size:.75rem;line-height:1.4;pointer-events:none}
.tip b,.tip span{display:block}
.bar:focus-visible .tip{display:block}
@media (hover:hover){.bar:hover{opacity:.75}.bars:has([aria-current]) .bar:hover{opacity:1}.bar:hover .tip{display:block}}
.selected{background:var(--surface);border:1px solid var(--line);border-radius:.75rem;padding:1.25rem;display:flex;flex-direction:column;gap:.75rem;scroll-margin-top:1rem}
.selected h2{margin:0;color:var(--fg)}
.selected .incident{border-left-width:1px}
.bar-summary{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.375rem}
.bar-summary{gap:.875rem}
.bar-summary li{font-size:.875rem}
.bar-summary .row{justify-content:flex-start;align-items:center;gap:.5rem}
.bars.hours{height:1.5rem;margin-top:.375rem}
.bars.hours .bar:nth-child(-n+4) .tip{left:0;right:auto;transform:none}.bars.hours .bar:nth-last-child(-n+4) .tip{left:auto;right:0;transform:none}
.bar-summary .num{margin-left:auto;text-align:right}
.dot{flex:none;width:.5rem;height:.5rem;border-radius:50%;background:var(--none)}
.dot.up{background:var(--up)}.dot.warn{background:var(--warn)}.dot.down{background:var(--down)}
.incident{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--tone,var(--line));border-radius:.75rem;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:.25rem}
.incident.down{--tone:var(--down)}.incident.warn{--tone:var(--warn)}.incident.info{--tone:var(--info)}
.history{display:flex;flex-direction:column;gap:.75rem}
.history .incident{border-left-width:1px}
.updates{list-style:none;margin:.5rem 0 0;padding:0;display:flex;flex-direction:column;gap:.625rem}
.updates p{margin-top:.125rem;white-space:pre-wrap}
footer{display:flex;flex-wrap:wrap;gap:1rem;justify-content:center;color:var(--muted);font-size:.8125rem;padding-top:1rem}
footer a{color:inherit}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
${rangeRules()}
`;
