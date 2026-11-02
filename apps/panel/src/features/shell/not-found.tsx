import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="font-medium">This page does not exist</p>
      <p className="text-muted-foreground">The link may be old, or the monitor was deleted.</p>
      <Link to="/monitors" className="mt-2 font-medium underline underline-offset-4">
        Go to monitors
      </Link>
    </div>
  );
}
