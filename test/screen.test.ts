// Screen settings (C-5.11) and ready check tally (C-11.19): the pure parts of the UI.
import { describe, expect, it } from "vitest";
import type { ReadyCheck, ScreenInfo } from "../src/core/protocol";
import { readyTally } from "../src/ui/Ready";
import { settingsChanges } from "../src/ui/Settings";

const screen: ScreenInfo = {
  code: "ABC123",
  name: "Movie night",
  visibility: "public",
  hidden: false,
  maxViewers: 10,
  showDevices: true,
  autoAdvance: true,
  bufferingPolicy: "keep",
};
const draft = (over: Partial<Parameters<typeof settingsChanges>[1]> = {}) => ({
  name: "Movie night",
  visibility: "public" as const,
  password: "",
  hidden: false,
  maxViewers: 10,
  showDevices: true,
  autoAdvance: true,
  bufferingPolicy: "keep" as const,
  ...over,
});

describe("settings changes (C-5.11)", () => {
  it("sends only what changed", () => {
    expect(settingsChanges(screen, draft())).toEqual({ changes: {} });
    expect(settingsChanges(screen, draft({ name: "  Anime   night " }))).toEqual({ changes: { name: "Anime night" } });
    expect(settingsChanges(screen, draft({ maxViewers: 4, bufferingPolicy: "wait" }))).toEqual({
      changes: { maxViewers: 4, bufferingPolicy: "wait" },
    });
  });

  it("going private needs a password; hidden only when private", () => {
    expect(settingsChanges(screen, draft({ visibility: "private" }))).toEqual({ error: "Set a password to make the screen private." });
    expect(settingsChanges(screen, draft({ visibility: "private", password: "pw", hidden: true }))).toEqual({
      changes: { visibility: "private", password: "pw", hidden: true },
    });
    expect(settingsChanges(screen, draft({ hidden: true }))).toEqual({ changes: {} });
  });

  it("an already private screen keeps its password unless a new one is given; going public clears hidden", () => {
    const priv = { ...screen, visibility: "private" as const, hidden: true };
    expect(settingsChanges(priv, draft({ visibility: "private", hidden: true }))).toEqual({ changes: {} });
    expect(settingsChanges(priv, draft({ visibility: "public" }))).toEqual({ changes: { visibility: "public", hidden: false } });
  });

  it("validates name and max viewers", () => {
    expect(settingsChanges(screen, draft({ name: "   " }))).toHaveProperty("error");
    expect(settingsChanges(screen, draft({ name: "x".repeat(65) }))).toHaveProperty("error");
    expect(settingsChanges(screen, draft({ maxViewers: 1 }))).toHaveProperty("error");
    expect(settingsChanges(screen, draft({ maxViewers: 26 }))).toHaveProperty("error");
  });
});

describe("ready tally (C-11.19.3)", () => {
  const r: ReadyCheck = { id: 1, by: "Host", deadline: 0, answers: { a: true, b: false, gone: true }, done: false };
  it("counts ready answers among connected viewers only", () => {
    expect(readyTally(r, ["a", "b", "c"])).toEqual({ n: 1, m: 3, everyone: false });
    expect(readyTally(r, ["a"])).toEqual({ n: 1, m: 1, everyone: true });
  });
});
