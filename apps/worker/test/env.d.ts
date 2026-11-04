declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("../src/runtime/worker");
    durableNamespaces: "Workspace" | "Directory" | "AuthStore" | "Probe";
  }
}
