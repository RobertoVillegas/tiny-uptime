export interface Clock {
  now(): number;
}

export interface Ids {
  /** A short random id (lowercase base32). */
  id(length?: number): string;
  /** Random hex with this many bytes of entropy. */
  secret(bytes: number): string;
  /** SHA-256 hex, used to store tokens without storing the token. */
  hash(text: string): Promise<string>;
}
