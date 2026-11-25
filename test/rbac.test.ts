// Client-side role rules (C-7, C-8, C-9): what the UI offers must match what the theatre allows.
import { describe, expect, it } from "vitest";
import { CATALOGUE, defaultPosition, latencyBand, rankOf, roleAccess, viewerActions } from "../src/core/rbac";
import { Permissions, type Role, type ViewerInfo } from "../src/core/protocol";

const ALL = CATALOGUE.map((c) => c.key);
const roles: Role[] = [
  { id: "cohost", name: "Co-host", colour: null, position: 900, permissions: ALL, builtin: true },
  { id: "viewer", name: "Viewer", colour: null, position: 0, permissions: ["chat.send", "chat.gif", "chat.react"], builtin: true },
  {
    id: "mod",
    name: "Mod",
    colour: "#3498db",
    position: 500,
    permissions: ["viewers.mute", "viewers.kick", "roles.assign"],
    builtin: false,
  },
  { id: "dj", name: "DJ", colour: null, position: 200, permissions: ["playlist.add"], builtin: false },
];
const v = (id: string, over: Partial<ViewerInfo> = {}): ViewerInfo => ({
  id,
  name: id,
  device: "web",
  isHost: false,
  rtt: 20,
  buffering: false,
  roles: [],
  coHost: null,
  actingHost: false,
  muted: false,
  permissions: ["chat.send"],
  connected: true,
  ...over,
});
const host = v("host", { isHost: true, permissions: ALL });
const kinds = (a: ReturnType<typeof viewerActions>) => a.map((x) => (x.kind === "role" ? `role:${x.role.id}:${x.assigned}` : x.kind));

describe("ranks", () => {
  it("host 1000, co-host and acting host 900, else the highest custom role, else 0", () => {
    expect(rankOf(host, roles)).toBe(1000);
    expect(rankOf(v("c", { coHost: 1 }), roles)).toBe(900);
    expect(rankOf(v("a", { actingHost: true }), roles)).toBe(900);
    expect(rankOf(v("m", { roles: ["dj", "mod"] }), roles)).toBe(500);
    expect(rankOf(v("x"), roles)).toBe(0);
  });

  it("the catalogue has exactly the 19 permissions", () => {
    expect(new Set(ALL).size).toBe(19);
    expect(ALL).toEqual(Object.values(Permissions));
  });

  it("a new role defaults just above the highest role you can manage", () => {
    expect(defaultPosition(1000, roles)).toBe(501);
    expect(defaultPosition(500, roles)).toBe(201);
    expect(defaultPosition(1, [])).toBe(0);
  });
});

describe("viewer actions (C-9.4, C-7)", () => {
  it("the host can do everything to a viewer", () => {
    expect(kinds(viewerActions(host, v("x"), roles, []))).toEqual([
      "mute",
      "kick",
      "ban",
      "role:mod:false",
      "role:dj:false",
      "permissions",
      "makeCoHost",
      "makeHost",
    ]);
  });

  it("co-host order actions follow the list; away viewers can't be made host", () => {
    const coHosts = [
      { id: "c1", name: "c1" },
      { id: "c2", name: "c2" },
    ];
    expect(kinds(viewerActions(host, v("c1", { coHost: 1 }), roles, coHosts)).filter((k) => !k.startsWith("role"))).toEqual([
      "mute",
      "kick",
      "ban",
      "permissions",
      "removeCoHost",
      "moveDown",
      "makeHost",
    ]);
    expect(kinds(viewerActions(host, v("c2", { coHost: 2, connected: false }), roles, coHosts))).toContain("moveUp");
    expect(kinds(viewerActions(host, v("c2", { coHost: 2, connected: false }), roles, coHosts))).not.toContain("makeHost");
  });

  it("a moderator acts only below their rank and only with their permissions", () => {
    const mod = v("mod", { roles: ["mod"], permissions: ["viewers.mute", "viewers.kick", "roles.assign"] });
    expect(kinds(viewerActions(mod, v("x", { muted: true }), roles, []))).toEqual(["unmute", "kick", "role:dj:false"]);
    expect(viewerActions(mod, v("peer", { roles: ["mod"] }), roles, [])).toEqual([]); // same rank
    expect(viewerActions(mod, host, roles, [])).toEqual([]);
  });

  it("the acting host can't change co-hosts or ownership, or act on other co-hosts (C-7.5)", () => {
    const acting = v("a", { actingHost: true, coHost: 1, permissions: ALL });
    expect(kinds(viewerActions(acting, v("x"), roles, [{ id: "a", name: "a" }]))).not.toContain("makeCoHost");
    expect(kinds(viewerActions(acting, v("x"), roles, []))).not.toContain("makeHost");
    expect(viewerActions(acting, v("c2", { coHost: 2 }), roles, [])).toEqual([]);
  });

  it("never offers actions on yourself", () => {
    expect(viewerActions(host, host, roles, [])).toEqual([]);
  });
});

describe("role access (C-8.5)", () => {
  const mod = v("mod", { roles: ["mod"], permissions: ["roles.manage", "viewers.mute"] });
  it("only roles below you, the Co-host role never, built-ins keep their details", () => {
    expect(roleAccess(host, roles[0]!, roles).editable).toBe(false); // Co-host
    expect(roleAccess(host, roles[1]!, roles)).toMatchObject({ editable: true, detailsEditable: false, deletable: false });
    expect(roleAccess(host, roles[2]!, roles)).toMatchObject({ editable: true, detailsEditable: true, deletable: true });
    expect(roleAccess(mod, roles[2]!, roles).editable).toBe(false); // own rank
    expect(roleAccess(mod, roles[3]!, roles).editable).toBe(true);
    expect(roleAccess(mod, roles[3]!, roles).grantable("viewers.kick")).toBe(false);
    expect(roleAccess(v("x"), roles[3]!, roles).editable).toBe(false); // no roles.manage
  });
});

describe("latency bands (C-10.6)", () => {
  it("green under 100 ms, yellow to 250 ms, red above; unknown is none", () => {
    expect([latencyBand(40), latencyBand(100), latencyBand(250), latencyBand(251), latencyBand(null)]).toEqual([
      "good",
      "fair",
      "fair",
      "poor",
      null,
    ]);
  });
});
