import "@tiny-uptime/ui/globals.css";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { notify, Toaster } from "@tiny-uptime/ui/components/toast";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { messageOf } from "./lib/api";
import { createAppRouter } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, error) => count < 2 && !(error instanceof Error && "status" in error && (error as { status: number }).status < 500),
    },
  },
  // Every failed change surfaces as a toast unless the form shows the error itself.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.inlineErrors) return;
      notify("That did not work", { description: messageOf(error), type: "error" });
    },
  }),
});

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { inlineErrors?: boolean };
  }
}

const router = createAppRouter(queryClient);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Toaster>
        <RouterProvider router={router} />
      </Toaster>
    </QueryClientProvider>
  </StrictMode>,
);
