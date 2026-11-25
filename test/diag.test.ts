// Diagnostics log and link error messages.
import { describe, expect, it } from "vitest";
import { DIAG_MAX, diag, short } from "../src/core/diag";
import { fileProblem, linkProblem, probeLink } from "../src/player/controller";

describe("diagnostics log", () => {
  it("keeps the newest entries, one line each, in order", () => {
    diag.clear();
    for (let i = 0; i < DIAG_MAX + 10; i++) diag.add("test", `entry ${i}`);
    expect(diag.size).toBe(DIAG_MAX);
    const lines = diag.text(["header"]).trim().split("\n");
    expect(lines[0]).toBe("# header");
    expect(lines[1]).toMatch(/test\s+entry 10$/);
    expect(lines.at(-1)).toMatch(/entry 3009$/);
    diag.clear();
  });

  it("shortens long values", () => {
    expect(short({ a: 1 })).toBe('{"a":1}');
    expect(short("x".repeat(400), 10)).toBe(`"${"x".repeat(9)}…`);
  });
});

describe("why a link didn't play", () => {
  const answer = (status: number, type = "video/mp4") =>
    (async () => new Response(null, { status, headers: { "content-type": type } })) as unknown as typeof fetch;

  it("names the server's refusal", async () => {
    expect(await probeLink("https://x.test/a.mp4", answer(403))).toBe(
      "The link answered 403: it may be private, expired, or blocked on your network.",
    );
    expect(await probeLink("https://x.test/a.mp4", answer(404))).toMatch(/^The link answered 404: the video isn't there/);
  });

  it("spots a web page given as a video link", async () => {
    expect(await probeLink("https://x.test/watch", answer(200, "text/html; charset=utf-8"))).toMatch(/web page, not a video file/);
  });

  it("says nothing more when the server is fine or won't answer the page", async () => {
    expect(await probeLink("https://x.test/a.mp4", answer(200))).toBeNull();
    const refuse = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await probeLink("https://x.test/a.mp4", refuse)).toBeNull();
  });

  it("doesn't blame the format alone for a link", () => {
    expect(linkProblem(4)).toMatch(/server may refuse it/);
    expect(linkProblem(2)).toMatch(/network error/);
    expect(fileProblem(4)).toMatch(/format or codec not supported/);
  });
});
