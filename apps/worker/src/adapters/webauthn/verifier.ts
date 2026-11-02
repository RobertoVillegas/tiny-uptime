import { server } from "@passwordless-id/webauthn";
import type { AuthenticationJSON, RegistrationJSON } from "@passwordless-id/webauthn/dist/esm/types";
import { Result } from "better-result";
import { Invalid, Unauthorized, type NewPasskey, type PasskeyVerifier, type StoredPasskey } from "@tiny-uptime/core";

/**
 * Verifies WebAuthn ceremonies for one origin: challenge, origin, RP id hash, user verification,
 * signature and (on sign-in) the signature counter. Registration trusts the public key the browser
 * reports, which is safe here because registering always needs an invite or a signed-in session.
 */
export function passkeyVerifier(origin: string): PasskeyVerifier {
  return {
    newChallenge: () => server.randomChallenge(),

    async verifyRegistration(registration: unknown, challenge: string): Promise<Result<NewPasskey, Invalid>> {
      try {
        const info = await server.verifyRegistration(registration as RegistrationJSON, { challenge, origin, userVerified: true });
        const name = info.authenticator.name;
        return Result.ok({
          id: info.credential.id,
          publicKey: info.credential.publicKey,
          algorithm: info.credential.algorithm,
          transports: info.credential.transports,
          counter: info.authenticator.counter,
          authenticatorName: name && name !== "Unknown" ? name : null,
        });
      } catch (error) {
        console.warn("passkey registration refused", error instanceof Error ? error.message : error);
        return Result.err(new Invalid({ field: "registration", message: "passkey verification failed" }));
      }
    },

    async verifyAuthentication(authentication: unknown, passkey: StoredPasskey, challenge: string): Promise<Result<{ counter: number }, Unauthorized>> {
      try {
        const info = await server.verifyAuthentication(
          authentication as AuthenticationJSON,
          { id: passkey.id, publicKey: passkey.publicKey, algorithm: passkey.algorithm, transports: passkey.transports as never },
          { challenge, origin, userVerified: true, counter: passkey.counter },
        );
        return Result.ok({ counter: info.counter });
      } catch (error) {
        return refused("sign-in", error);
      }
    },
  };
}

function refused(ceremony: "sign-in", error: unknown): Result<never, Unauthorized> {
  console.warn(`passkey ${ceremony} refused`, error instanceof Error ? error.message : error);
  return Result.err(new Unauthorized({ message: "passkey verification failed" }));
}
