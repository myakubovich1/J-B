import { describe, it, expect } from "vitest";
import { readBoundedBody, readJson } from "../src/lib/http";
describe("request size enforcement", () => {
  it("bounds chunked bodies even without Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40));
        controller.enqueue(new Uint8Array(40));
        controller.close();
      },
    });
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(readBoundedBody(request, 64)).rejects.toMatchObject({ status: 413 });
  });
  it("parses bounded JSON and rejects malformed input", async () => {
    expect(
      await readJson(
        new Request("http://localhost/test", {
          method: "POST",
          body: JSON.stringify({ ok: true }),
        }),
      ),
    ).toEqual({ ok: true });
    await expect(
      readJson(new Request("http://localhost/test", { method: "POST", body: "invalid" })),
    ).rejects.toMatchObject({ status: 400 });
  });
});
