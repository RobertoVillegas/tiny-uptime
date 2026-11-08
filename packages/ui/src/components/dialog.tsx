import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "../cn";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./button";

const backdrop =
  "fixed inset-0 bg-black/30 transition-opacity duration-150 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 dark:bg-black/60";
const popup = cn(
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col",
  "overflow-y-auto rounded-card bg-surface-raised p-6 shadow-raised outline-none",
  "transition-[opacity,scale] duration-150 ease-out data-starting-style:scale-96 data-starting-style:opacity-0",
  "data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:ease-in",
);

type DialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A modal with a title, an optional description and a close button; focus stays inside while open. */
export function Dialog({ open, onOpenChange, trigger, title, description, children, className }: DialogProps) {
  return (
    <DialogPrimitive.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange: (o: boolean) => onOpenChange(o) } : {})}
    >
      {trigger ? <DialogPrimitive.Trigger render={trigger as React.ReactElement} /> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className={backdrop} />
        <DialogPrimitive.Popup className={cn(popup, className)}>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="text-base font-semibold text-balance">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-muted-foreground">{description}</DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close render={<Button variant="ghost" size="icon" aria-label="Close" className="-mt-1.5 -mr-2" />}>
              <X />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type ConfirmProps = {
  /** Opens the dialog on click; leave it out and control it with `open`, e.g. from a menu item. */
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  /** May return a promise; the dialog waits for it before closing. */
  onConfirm: () => unknown;
  pending?: boolean;
};

/**
 * Confirms a destructive action. The destructive button sits apart from the safe one. The dialog
 * closes once `onConfirm` settles; when it rejects the dialog stays open so the action can be
 * retried, and the caller's own error handling reports why.
 */
export function ConfirmDialog({ trigger, open, onOpenChange, title, description, confirmLabel, onConfirm, pending }: ConfirmProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const confirm = async () => {
    try {
      await onConfirm();
    } catch {
      return;
    }
    setOpen(false);
  };
  return (
    <AlertDialog.Root open={open ?? ownOpen} onOpenChange={setOpen}>
      {trigger ? <AlertDialog.Trigger render={trigger} /> : null}
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdrop} />
        <AlertDialog.Popup className={cn(popup, "max-w-md")}>
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1 text-muted-foreground">{description}</AlertDialog.Description>
          <div className="mt-6 flex justify-between gap-3">
            <AlertDialog.Close render={<Button variant="secondary" />}>Cancel</AlertDialog.Close>
            <Button variant="danger" loading={pending ?? false} onClick={() => void confirm()}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
