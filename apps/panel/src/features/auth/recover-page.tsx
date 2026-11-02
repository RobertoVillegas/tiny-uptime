import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { RecoveryInput } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { api, messageOf } from "../../lib/api";
import { firstError } from "../../lib/forms";
import { AuthLayout } from "./auth-layout";

export function RecoverPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const recover = useMutation({
    meta: { inlineErrors: true },
    mutationFn: (input: { email: string; code: string }) => api.auth.recover(input.email, input.code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await navigate({ to: "/account", hash: "passkeys" });
    },
  });
  const form = useForm({
    defaultValues: { email: "", code: "" },
    validators: { onSubmit: RecoveryInput },
    onSubmit: ({ value }) => recover.mutate(value),
  });

  return (
    <AuthLayout
      title="Use a recovery code"
      description="Each code works once. After signing in, add a new passkey so you are not locked out again."
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="email">
          {(field) => (
            <Field label="Email" error={firstError(field.state.meta.errors)}>
              <Input
                type="email"
                autoComplete="email"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="code">
          {(field) => (
            <Field label="Recovery code" description="It looks like abcde-fghij." error={firstError(field.state.meta.errors)}>
              <Input
                autoComplete="one-time-code"
                spellCheck={false}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>
        {recover.isError ? (
          <p role="alert" className="text-[0.8125rem] text-down">
            {messageOf(recover.error)}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="w-full" loading={recover.isPending}>
          Sign in with recovery code
        </Button>
        <Link to="/login" className="text-center text-[0.8125rem] text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  );
}
