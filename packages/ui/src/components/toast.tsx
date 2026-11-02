import { Toast } from "@base-ui/react/toast";
import { cn } from "cn";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/** One manager for the whole app, so code outside React (mutations, error handlers) can raise toasts. */
export const toasts = Toast.createToastManager();

/** How long a toast stays: long enough to read it, at about 220 words a minute, with a floor. */
function durationFor(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(4000, Math.round((words / 220) * 60_000) + 1500);
}

export function notify(title: string, options: { description?: string; type?: "success" | "error" } = {}): void {
  toasts.add({ title, ...options, timeout: durationFor(`${title} ${options.description ?? ""}`) });
}

export function Toaster({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={toasts}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] w-[calc(100vw-2rem)] sm:w-90">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts: list } = Toast.useToastManager();
  return list.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className={cn(
        "absolute right-0 bottom-0 w-full rounded-card bg-surface-raised shadow-raised select-none",
        "[transform:translateY(calc(var(--toast-index)*-0.6rem))_scale(calc(1-var(--toast-index)*0.04))]",
        "transition-[opacity,transform] duration-200 ease-out data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0",
        "data-[ending-style]:opacity-0 data-[ending-style]:ease-in data-[limited]:opacity-0",
      )}
    >
      <Toast.Content className="flex items-start gap-3 p-3.5">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full bg-paused",
            toast.type === "success" && "bg-up",
            toast.type === "error" && "bg-down",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Toast.Title className="font-medium" />
          <Toast.Description className="text-muted-foreground" />
        </div>
        <Toast.Close aria-label="Dismiss" className="-m-1 rounded-control p-1 text-muted-foreground hover:bg-subtle hover:text-foreground">
          <X className="size-4" />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}
