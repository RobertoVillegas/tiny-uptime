import type { CheckOutcome, EvmTarget, RpcTarget } from "@tiny-uptime/core";
import { callRpc, checkRpc } from "./json-rpc";

/** Up when the node says it is not syncing and, when one is set, serves the expected chain. */
export function checkEvm(target: EvmTarget): Promise<CheckOutcome> {
  return checkRpc(target, async (endpoint) => {
    const { result: syncing } = await callRpc(endpoint, "eth_syncing", [], 1);
    if (syncing !== false) {
      const isProgress = syncing !== null && typeof syncing === "object";
      return { ok: false, detail: isProgress ? `node is syncing${progress(syncing)}` : "eth_syncing returned an unexpected result" };
    }
    if (target.chainId === undefined) return { ok: true, detail: "synced" };
    const { result } = await callRpc(endpoint, "eth_chainId", [], 2);
    const chainId = hex(result);
    if (chainId === target.chainId) return { ok: true, detail: `synced, chain ${chainId}` };
    return {
      ok: false,
      detail: chainId === null ? "eth_chainId returned an unexpected result" : `on chain ${chainId}, expected ${target.chainId}`,
    };
  });
}

/** Up when getHealth answers "ok"; an unhealthy node answers with an error that says how far behind it is. */
export function checkSolana(target: RpcTarget): Promise<CheckOutcome> {
  return checkRpc(target, async (endpoint) => {
    const { result } = await callRpc(endpoint, "getHealth", [], 1);
    return result === "ok" ? { ok: true, detail: "healthy" } : { ok: false, detail: "getHealth did not answer ok" };
  });
}

function progress(status: object): string {
  const { currentBlock, highestBlock } = status as { currentBlock?: unknown; highestBlock?: unknown };
  const current = hex(currentBlock);
  const highest = hex(highestBlock);
  return current !== null && highest !== null ? ` (block ${current} of ${highest})` : "";
}

function hex(value: unknown): number | null {
  return typeof value === "string" && /^0x[0-9a-f]{1,13}$/i.test(value) ? Number.parseInt(value, 16) : null;
}
