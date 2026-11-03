/** Styles for the public status page, inlined so the page is one request. Same OKLCH tokens as the panel. */
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
@media (max-width:40rem){.bars.long{grid-template-columns:repeat(45,1fr)}.bars.long .bar:nth-child(-n+45){display:none}.wide{display:none}.narrow{display:inline}}
.ranges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.25rem;margin-bottom:-.75rem}
.ranges a{color:var(--muted);font-size:.8125rem;text-decoration:none;padding:.25rem .625rem;border-radius:999px;border:1px solid transparent}
.ranges a:hover{color:var(--fg)}
.ranges:has(+.zone-note){margin-bottom:0}
.zone-note{text-align:right;margin:.25rem 0 -.75rem}
.ranges a[aria-current]{color:var(--fg);background:var(--surface);border-color:var(--line);font-weight:500}
@media (max-width:40rem){.ranges{flex-wrap:nowrap;justify-content:space-between;gap:0}.ranges a{padding:.25rem .4rem;font-size:.75rem;white-space:nowrap}}
.bar{position:relative;border-radius:2px;background:var(--none);outline-offset:2px}
.bar.up{background:var(--up)}.bar.warn{background:var(--warn)}.bar.down{background:var(--down)}
.bar:hover,.bar:focus-visible{opacity:.75}
.tip{display:none;position:absolute;bottom:calc(100% + .5rem);left:50%;transform:translateX(-50%);z-index:2;width:max-content;max-width:14rem;padding:.5rem .625rem;border-radius:.5rem;background:var(--fg);color:var(--bg);font-size:.75rem;line-height:1.4;pointer-events:none}
.tip b{display:block}
.bar:hover .tip,.bar:focus-visible .tip{display:block}
.bar:nth-child(-n+8) .tip{left:0;transform:none}.bar:nth-last-child(-n+8) .tip{left:auto;right:0;transform:none}
.incident{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--tone,var(--line));border-radius:.75rem;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:.25rem}
.incident.down{--tone:var(--down)}.incident.warn{--tone:var(--warn)}.incident.info{--tone:var(--info)}
.history{display:flex;flex-direction:column;gap:.75rem}
.history .incident{border-left-width:1px}
.updates{list-style:none;margin:.5rem 0 0;padding:0;display:flex;flex-direction:column;gap:.625rem}
.updates p{margin-top:.125rem;white-space:pre-wrap}
footer{display:flex;flex-wrap:wrap;gap:1rem;justify-content:center;color:var(--muted);font-size:.8125rem;padding-top:1rem}
footer a{color:inherit}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;
