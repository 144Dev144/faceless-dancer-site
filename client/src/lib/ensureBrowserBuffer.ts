import { Buffer } from "buffer";

const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer };

if (!browserGlobal.Buffer) {
  browserGlobal.Buffer = Buffer;
}
