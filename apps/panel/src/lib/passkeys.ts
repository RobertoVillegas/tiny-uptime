import { client } from "@passwordless-id/webauthn";

/** Whether this browser can use passkeys at all. */
export const passkeysAvailable = (): boolean => client.isAvailable();

export function createPasskey(challenge: string, user: { id?: string; name: string; displayName: string }) {
  // Discoverable, so sign-in needs no email: the browser offers the saved passkey.
  return client.register({ challenge, user, discoverable: "required", userVerification: "required", attestation: false });
}

export function usePasskey(challenge: string) {
  return client.authenticate({ challenge, userVerification: "required" });
}
