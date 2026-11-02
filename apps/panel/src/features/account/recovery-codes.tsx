import { CopyButton } from "@tiny-uptime/ui/components/copy-button";

/** Recovery codes in a grid, with copy; shown once after they are issued. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ol className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-control bg-subtle p-4 font-mono text-[0.8125rem] tabular-nums">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <CopyButton text={codes.join("\n")} label="Copy codes" className="self-start" />
    </div>
  );
}
