import { encode } from "uqr";

/** A QR code drawn as SVG squares, so authenticator apps can scan the setup link. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 2 });
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="size-40 rounded-control bg-white p-1"
      shapeRendering="crispEdges"
    >
      {data.flatMap((row, y) =>
        row.map((dark, x) => (dark ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="black" /> : null)),
      )}
    </svg>
  );
}
