/// <reference lib="dom" />
const subtle: SubtleCrypto = window.crypto.subtle;

export class DataEncryptor {
  private static async deriveKey(passphrase: string) {
    const encoder = new TextEncoder();
    const keyMaterial = await subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    
    return subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encoder.encode("navigraph-salt"),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  static async encrypt(data: string, passphrase: string) {
    const key = await this.deriveKey(passphrase);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(data)
    );
    return JSON.stringify({
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted))
    });
  }
}