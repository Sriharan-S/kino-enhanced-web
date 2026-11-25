// The device secret (32 random bytes, created once, never sent). Per-screen tokens are derived from it so different
// screens can't link the same viewer (spec §5): token = hex(HMAC-SHA256(secret, screenId)), as on every platform.
import { load, store } from "./net";

const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

export class DeviceIdentity {
  private constructor(private readonly key: CryptoKey) {}

  /**
   * Loads or creates the secret. A profile (`?profile=` in the URL) gives a separate identity, so two tabs of one
   * browser can join the same screen as different viewers (otherwise the second tab replaces the first).
   */
  static async loadOrCreate(profile = "default"): Promise<DeviceIdentity> {
    const storageKey = profile === "default" ? "kino.device" : `kino.device.${profile}`;
    let hex = load(storageKey);
    if (!hex || !/^[0-9a-f]{64}$/.test(hex)) {
      hex = toHex(crypto.getRandomValues(new Uint8Array(32)));
      store(storageKey, hex);
    }
    return DeviceIdentity.fromSecret(fromHex(hex));
  }

  static async fromSecret(secret: Uint8Array): Promise<DeviceIdentity> {
    if (secret.length !== 32) throw new Error("secret must be 32 bytes");
    const key = await crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new DeviceIdentity(key);
  }

  async tokenFor(screenId: string): Promise<string> {
    return toHex(await crypto.subtle.sign("HMAC", this.key, new TextEncoder().encode(screenId)));
  }
}
