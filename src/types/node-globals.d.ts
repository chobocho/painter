// Minimal Node typings used by the test runner / Layer base64 helpers.
// We don't depend on @types/node — just declare what we touch.

declare const process: {
  exit(code?: number): never;
  versions: { node: string };
};

declare class Buffer extends Uint8Array {
  static from(data: ArrayBufferLike | Uint8Array, byteOffset?: number, length?: number): Buffer;
  static from(s: string, encoding?: string): Buffer;
  toString(encoding?: string): string;
}
