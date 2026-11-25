// Ported from the Windows ChatTests.cs, plus the theatre's text rules.
import { describe, expect, it } from "vitest";
import { cleanChatText, isGifLink, parseGiphy } from "../src/core/chat";

describe("GIF links (C-18.5)", () => {
  it.each([
    ["https://media.giphy.com/media/abc/giphy.gif", true],
    ["https://media2.giphy.com/media/abc/200.gif", true],
    ["https://i.giphy.com/abc.webp", true],
    ["https://media.tenor.com/x/y.gif", true],
    ["https://c.tenor.com/x/y.gif", true],
    ["https://static.klipy.com/x.gif", true],
    ["http://media.giphy.com/media/abc/giphy.gif", false],
    ["https://media.giphy.com:8443/x.gif", false],
    ["https://user@media.giphy.com/x.gif", false],
    ["https://media.giphy.com.evil.example/x.gif", false],
    ["https://evil.example/giphy.gif", false],
    ["not a link", false],
  ])("%s → %s", (url, ok) => expect(isGifLink(url)).toBe(ok));
});

describe("GIPHY results (C-18.4)", () => {
  it("uses the small preview for the picker and fixed_height to send", () => {
    const r = parseGiphy({
      data: [
        {
          title: "  Party  ",
          images: {
            fixed_width_small: { url: "https://media.giphy.com/media/a/100w.gif" },
            fixed_height: { url: "https://media.giphy.com/media/a/200.gif", width: "356", height: "200" },
          },
        },
        { title: "no images" },
        {
          title: "bad host",
          images: { fixed_width: { url: "https://x.example/p.gif" }, fixed_height: { url: "https://x.example/s.gif" } },
        },
      ],
    });
    expect(r).toEqual([
      {
        previewUrl: "https://media.giphy.com/media/a/100w.gif",
        gif: { url: "https://media.giphy.com/media/a/200.gif", width: 356, height: 200, title: "Party" },
      },
    ]);
    expect(parseGiphy(null)).toEqual([]);
  });
});

describe("chat text (C-18.1)", () => {
  it("drops control characters, keeps newlines and collapses blank runs", () => {
    expect(cleanChatText("  hi\u0007 there \r\n\r\n\r\n\r\nbye  ")).toBe("hi there \n\nbye");
    expect(cleanChatText("\t\n ")).toBe("");
  });
});
