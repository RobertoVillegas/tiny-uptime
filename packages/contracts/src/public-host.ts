/**
 * Static check for hosts that can only be internal: private, loopback and link-local IPs, and names such as
 * `localhost`, `*.internal` or a single label. Alert channels post to URLs people type in, and a URL like that is a
 * way to probe the network the sender runs in. Cloudflare refuses private ranges on its own; this keeps the rule
 * explicit and gives a clear error when the channel is saved. It mirrors OpenUptime's netguard, minus DNS resolution.
 */
const INTERNAL_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".home.arpa", ".lan", ".intranet", ".corp", ".private"];
const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function v4Private(a: number, b: number, c: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** IPv6 literals: anything but a global unicast address is refused, including IPv4-mapped private ones. */
function v6Private(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return hostIsPrivate(mapped[1]!);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) return true;
  return ip === "::" || ip === "::1" || /^(f[c-f]|ff|0|::)/.test(ip) || ip.startsWith("2001:db8:");
}

/** `host` as URL.hostname gives it: lower-case, IPv4 spellings normalised, IPv6 in brackets. */
export function hostIsPrivate(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h.startsWith("[")) return v6Private(h.slice(1, -1));
  const v4 = V4.exec(h);
  if (v4) return v4Private(Number(v4[1]), Number(v4[2]), Number(v4[3]));
  if (h === "localhost" || INTERNAL_SUFFIXES.some((suffix) => h.endsWith(suffix))) return true;
  return !h.includes(".");
}
