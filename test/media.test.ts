// Ported from MediaMatchTests.cs, InviteLinkTests.cs, YouTubeTests.cs, TheatreDirectoryTests.cs and LobbyViewTests.cs.
import { describe, expect, it } from "vitest";
import {
  appLink,
  autoMap,
  compare,
  durationMatches,
  type LocalFile,
  nameMatches,
  naturalCompare,
  parseInvite,
  webLink,
  youTubeId,
} from "../src/core/media";
import { applyLobbyQuery, isAllowedUrl, type LobbyQuery, mergeLobbies, parseDirectory, type TheatreLobby } from "../src/core/net";
import type { Anchor, Item } from "../src/core/protocol";
import { SimHarness } from "./sim";

const local = (id: string, name: string, duration: number | null): Item => ({ id, kind: "local", name, duration });
const file = (name: string, duration: number | null): LocalFile => ({ key: name, name, duration });

describe("media matching", () => {
  it("tolerance is the larger of 2 s and 0.5%", () => {
    expect(durationMatches(100, 101.9)).toBe(true);
    expect(durationMatches(100, 102.1)).toBe(false);
    expect(durationMatches(1420, 1427)).toBe(true);
    expect(durationMatches(1420, 1428)).toBe(false);
    expect(durationMatches(7200, 7235)).toBe(true);
    expect(durationMatches(7200, 7237)).toBe(false);
    expect(durationMatches(null, 100)).toBe(false);
  });

  it.each([
    ["EP 01.mkv", "ep_01.mp4", true],
    ["Movie.2019.1080p.mkv", "movie 2019 1080p.avi", true],
    ["A -- B.mkv", "a b.mkv", true],
    ["EP 01.mkv", "EP 02.mkv", false],
    ["Clip C", "clip_c", true],
  ])("names: %s vs %s", (a, b, same) => expect(nameMatches(a, b)).toBe(same));

  it("compares duration first, then name", () => {
    const host = local("i1", "EP 01.mkv", 1420.5);
    expect(compare(host, file("ep.01.mp4", 1420))).toBe("match");
    expect(compare(host, file("random name.mkv", 1421))).toBe("likelyMatch");
    expect(compare(host, file("EP 01.mkv", 1300))).toBe("mismatch");
    expect(compare(local("i2", "x.mkv", null), file("x.mp4", 50))).toBe("match");
  });

  it("auto-maps duration then name, each file once", () => {
    const items: Item[] = [
      local("i1", "EP 01.mkv", 1420),
      local("i2", "EP 02.mkv", 1380),
      local("i3", "EP 03.mkv", 1500),
      { id: "i4", kind: "url", name: "Clip", duration: null, url: "https://x/c.mp4" },
    ];
    const files = [file("Show - 02.mkv", 1380.5), file("EP 01.mkv", 1420.2), file("EP 03.mkv", 1200), file("EP 01 (copy).mkv", 1420.1)];
    const map = autoMap(items, files);
    expect(map.get("i1")?.name).toBe("EP 01.mkv");
    expect(map.get("i2")?.name).toBe("Show - 02.mkv");
    expect(map.get("i3")?.name).toBe("EP 03.mkv");
    expect(map.has("i4")).toBe(false);
    expect(compare(items[2]!, map.get("i3")!)).toBe("mismatch");
  });

  it("keeps manual mappings", () => {
    const map = autoMap([local("i1", "EP 01.mkv", 1420)], [file("EP 01.mkv", 1420)], new Map([["i1", file("my pick.mkv", 900)]]));
    expect(map.get("i1")?.name).toBe("my pick.mkv");
  });

  it("natural sort orders numbers by value", () => {
    const names = ["EP 10.mkv", "ep 2.mkv", "EP 1.mkv", "Extra.mkv", "EP 02b.mkv"];
    expect([...names].sort(naturalCompare)).toEqual(["EP 1.mkv", "ep 2.mkv", "EP 02b.mkv", "EP 10.mkv", "Extra.mkv"]);
  });
});

describe("playlist engine", () => {
  const playing = (item: string, position: number, at: number, seq: number): Anchor => ({
    itemId: item,
    state: "playing",
    position,
    rate: 1,
    at,
    seq,
  });

  it("holds while the current item has no file loaded", () => {
    const h = new SimHarness();
    h.engine.requireLoadedItem = true;
    h.engine.loadedItemId = "i1";
    h.player.pos = 50;
    h.player.paused = false;
    h.engine.applyAnchor(playing("i2", 0, h.theatreMs, 1));
    h.run(1);
    expect(h.engine.status.zone).toBe("noFile");
    expect(h.player.paused).toBe(true);
    expect(h.player.seeks).toBe(0);
    h.engine.loadedItemId = "i2";
    h.player.pos = 0;
    h.run(3);
    expect(h.player.paused).toBe(false);
    expect(Math.abs(h.trueDrift)).toBeLessThanOrEqual(0.25);
  });

  it("a shorter copy waits at its end without seek loops", () => {
    const h = new SimHarness();
    h.player.length = 95;
    h.player.pos = 90;
    h.player.paused = false;
    h.engine.applyAnchor(playing("i1", 90, h.theatreMs, 1));
    h.run(15);
    expect(h.engine.status.zone).toBe("waiting");
    expect(h.player.paused).toBe(true);
    expect(h.player.seeks).toBe(0);
  });
});

describe("invite links", () => {
  it.each([
    "kino://join/aurora/7K3QXM",
    "kino://join/aurora/7K3QXM/",
    "https://kino-directory.srie.workers.dev/join#aurora/7K3QXM",
    "https://kino-directory.srie.workers.dev/join/#aurora/7k3qxm",
    "https://kino-web.srie.workers.dev/#aurora/7K3QXM",
    "#aurora/7K3QXM",
    "  aurora/7k3qxm  ",
  ])("parses %s", (text) => expect(parseInvite(text)).toEqual({ theatreId: "aurora", code: "7K3QXM" }));

  it("normalises look-alikes like the theatre", () => expect(parseInvite("kino://join/nova/IoaLbO")?.code).toBe("10A1B0"));

  it.each([
    "kino://join/aurora/7K3QX",
    "kino://join/aurora/7K3QXMM",
    "kino://join/aurora/7K3QXU",
    "kino://join/9aurora/7K3QXM",
    "kino://watch/aurora/7K3QXM",
    "http://evil.example/join#aurora/7K3QXM",
    "kino://join/aurora/7K3QXM?x=<script>",
    "C:\\Videos\\movie.mkv",
    "",
  ])("rejects %s", (text) => expect(parseInvite(text)).toBeNull());

  it("builds both link forms", () => {
    const l = { theatreId: "aurora", code: "7K3QXM" };
    expect(appLink(l)).toBe("kino://join/aurora/7K3QXM");
    expect(webLink(l)).toBe("https://kino-directory.srie.workers.dev/join#aurora/7K3QXM");
    expect(parseInvite(webLink(l))).toEqual(l);
  });
});

describe("YouTube ids", () => {
  it.each([
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?list=x&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://evil.example/watch?v=dQw4w9WgXcQ", null],
    ["http://youtu.be/dQw4w9WgXcQ", null],
  ])("%s", (text, id) => expect(youTubeId(text)).toBe(id));
});

describe("theatre directory", () => {
  it("accepts valid files and drops bad entries", () => {
    const list = parseDirectory(
      JSON.stringify({
        version: 1,
        theatres: [
          { id: "aurora", name: "Aurora", url: "https://a.example" },
          { id: "aurora", name: "Dup", url: "https://b.example" },
          { id: "evil", name: "Evil", url: "http://evil.example" },
          { id: "", name: "x", url: "https://c.example" },
          { id: "dev", name: "Dev", url: "http://localhost:8787" },
        ],
      }),
    );
    expect(list?.map((t) => t.id)).toEqual(["aurora", "dev"]);
  });

  it("rejects unusable files", () => {
    expect(parseDirectory("nope")).toBeNull();
    expect(parseDirectory('{"version":2,"theatres":[{"id":"a","name":"A","url":"https://a.example"}]}')).toBeNull();
    expect(parseDirectory('{"version":1,"theatres":[]}')).toBeNull();
    expect(isAllowedUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("unified lobby", () => {
  const t = (id: string) => ({ id, name: id, url: `https://${id}.example` });
  const s = (
    code: string,
    name: string,
    viewers: number,
    max = 10,
    visibility: "public" | "private" = "public",
    host: string | null = null,
  ) => ({
    code,
    name,
    visibility,
    viewers,
    maxViewers: max,
    host,
  });
  const lobbies: TheatreLobby[] = [
    {
      theatre: t("aurora"),
      screens: [s("AAAAAA", "Movie night", 3, 10, "public", "Alice"), s("BBBBBB", "Full house", 10, 10)],
      requestMs: 40,
      failure: null,
    },
    { theatre: t("nova"), screens: [s("CCCCCC", "Anime", 5, 10, "private")], requestMs: 20, failure: null },
    { theatre: t("down"), screens: [], requestMs: null, failure: "timed out" },
  ];
  const q = (over: Partial<LobbyQuery> = {}): LobbyQuery => ({ search: "", visibility: "all", theatreId: null, sort: "viewers", ...over });
  const names = (over?: Partial<LobbyQuery>) => applyLobbyQuery(mergeLobbies(lobbies), q(over)).map((e) => e.screen.name);

  it("sorts by viewers with full screens last", () => expect(names()).toEqual(["Anime", "Movie night", "Full house"]));
  it("sorts by ping and by name", () => {
    expect(names({ sort: "ping" })[0]).toBe("Anime");
    expect(names({ sort: "name" })).toEqual(["Anime", "Full house", "Movie night"]);
  });
  it("filters by search, host, code, visibility and theatre", () => {
    expect(names({ search: "movie" })).toEqual(["Movie night"]);
    expect(names({ search: "alice" })).toEqual(["Movie night"]);
    expect(names({ search: "cccccc" })).toEqual(["Anime"]);
    expect(names({ visibility: "private" })).toEqual(["Anime"]);
    expect(names({ theatreId: "aurora" })).toEqual(["Movie night", "Full house"]);
  });
});
