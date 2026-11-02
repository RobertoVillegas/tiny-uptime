// A software passkey for tests: real P-256 keys and signatures, shaped like a browser's WebAuthn JSON.

const encoder = new TextEncoder();

export function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** WebCrypto signs ECDSA as raw r||s; WebAuthn carries it DER-encoded. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if (v[0]! & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export class VirtualAuthenticator {
  counter = 0;
  private constructor(
    readonly id: string,
    private readonly keys: CryptoKeyPair,
    private readonly publicKey: string,
  ) {}

  static async create(): Promise<VirtualAuthenticator> {
    const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair;
    const spki = (await crypto.subtle.exportKey("spki", keys.publicKey)) as ArrayBuffer;
    return new VirtualAuthenticator(b64url(crypto.getRandomValues(new Uint8Array(16))), keys, b64url(spki));
  }

  private async authData(rpId: string, flags: number, extra = new Uint8Array(0)): Promise<Uint8Array> {
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, this.counter);
    return concat(await sha256(encoder.encode(rpId)), new Uint8Array([flags]), counter, extra);
  }

  async register(opts: { challenge: string; origin: string; userVerified?: boolean }) {
    const clientData = encoder.encode(JSON.stringify({ type: "webauthn.create", challenge: opts.challenge, origin: opts.origin }));
    const flags = 0x01 | (opts.userVerified === false ? 0 : 0x04) | 0x40;
    const authenticatorData = await this.authData(new URL(opts.origin).hostname, flags, new Uint8Array(16));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      user: { id: "test-user", name: "test", displayName: "Test" },
      response: {
        clientDataJSON: b64url(clientData),
        attestationObject: "",
        authenticatorData: b64url(authenticatorData),
        publicKey: this.publicKey,
        publicKeyAlgorithm: -7,
        transports: ["internal"],
      },
    };
  }

  async authenticate(opts: { challenge: string; origin: string; rpId?: string; bumpCounter?: boolean }) {
    if (opts.bumpCounter !== false) this.counter++;
    const clientData = encoder.encode(JSON.stringify({ type: "webauthn.get", challenge: opts.challenge, origin: opts.origin }));
    const authenticatorData = await this.authData(opts.rpId ?? new URL(opts.origin).hostname, 0x05);
    const signed = concat(authenticatorData, await sha256(clientData));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, signed));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(rawToDer(raw)),
        userHandle: null,
      },
    };
  }
}
