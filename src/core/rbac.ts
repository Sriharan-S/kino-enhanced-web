// Roles and permissions on the client (spec §7–§9). The theatre enforces everything; these rules only decide what the
// UI offers, and mirror the theatre's `rbac.ts` (and the Windows client's Permissions.cs) exactly.
import { type CoHostInfo, Permissions as P, type Role, type ViewerInfo } from "./protocol";

/** All 19 permissions in catalogue order, grouped for display; same labels as the Windows client. */
export const CATALOGUE: { group: string; key: string; label: string }[] = [
  { group: "Playback", key: P.PlaybackToggle, label: "Play and pause" },
  { group: "Playback", key: P.PlaybackSeek, label: "Seek" },
  { group: "Playback", key: P.PlaybackSkip, label: "Next / previous item" },
  { group: "Playlist", key: P.PlaylistAdd, label: "Add local files" },
  { group: "Playlist", key: P.PlaylistAddExternal, label: "Add YouTube / links" },
  { group: "Playlist", key: P.PlaylistRemove, label: "Remove items" },
  { group: "Playlist", key: P.PlaylistReorder, label: "Reorder items" },
  { group: "Screen", key: P.SubtitlesShare, label: "Share subtitles" },
  { group: "Screen", key: P.ReadyCheck, label: "Start a ready check" },
  { group: "Screen", key: P.ScreenSettings, label: "Edit screen settings" },
  { group: "Screen", key: P.ScreenInvite, label: "See and regenerate the invite code" },
  { group: "Chat", key: P.ChatSend, label: "Send messages" },
  { group: "Chat", key: P.ChatGif, label: "Send GIFs" },
  { group: "Chat", key: P.ChatReact, label: "Send reactions" },
  { group: "Moderation", key: P.ViewersMute, label: "Chat-mute viewers" },
  { group: "Moderation", key: P.ViewersKick, label: "Kick viewers" },
  { group: "Moderation", key: P.ViewersBan, label: "Ban viewers" },
  { group: "Roles", key: P.RolesAssign, label: "Assign roles" },
  { group: "Roles", key: P.RolesManage, label: "Create and edit roles, set overrides" },
];

export const RANK = { host: 1000, cohost: 900, customMax: 899, customMin: 1, viewer: 0 } as const;
export const COHOST_ROLE = "cohost";
export const VIEWER_ROLE = "viewer";
export const MAX_CUSTOM_ROLES = 20;
export const ROLE_COLOURS = ["#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c", "#3498db", "#9b59b6", "#e91e63", "#95a5a6"];

/** Host 1000, co-host or acting host 900, else the highest custom role, else 0. */
export function rankOf(v: ViewerInfo, roles: Role[]): number {
  if (v.isHost) return RANK.host;
  if (v.coHost != null || v.actingHost) return RANK.cohost;
  return Math.max(RANK.viewer, ...roles.filter((r) => !r.builtin && (v.roles ?? []).includes(r.id)).map((r) => r.position));
}

const has = (v: ViewerInfo, p: string) => !!v.permissions?.includes(p);

/** Default rank for a new role: just above the highest custom role the actor can manage. */
export function defaultPosition(actorRank: number, roles: Role[]): number {
  const below = roles.filter((r) => !r.builtin && r.position < actorRank).map((r) => r.position);
  const pos = below.length ? Math.max(...below) + 1 : RANK.customMin;
  return Math.min(pos, actorRank - 1, RANK.customMax);
}

export type ViewerAction =
  | { kind: "mute" | "unmute" | "kick" | "ban" | "permissions" | "makeCoHost" | "removeCoHost" | "moveUp" | "moveDown" | "makeHost" }
  | { kind: "role"; role: Role; assigned: boolean };

/**
 * The actions `me` may take on `target` (C-9.4): moderation and roles need the permission and a target ranked strictly
 * below you; co-host changes and ownership are the host's alone (not the acting host's, C-7.5). Never for yourself.
 */
export function viewerActions(me: ViewerInfo | null, target: ViewerInfo, roles: Role[], coHosts: CoHostInfo[]): ViewerAction[] {
  if (!me || me.id === target.id) return [];
  const myRank = rankOf(me, roles);
  const below = myRank > rankOf(target, roles);
  const out: ViewerAction[] = [];
  if (below && has(me, P.ViewersMute)) out.push({ kind: target.muted ? "unmute" : "mute" });
  if (below && has(me, P.ViewersKick)) out.push({ kind: "kick" });
  if (below && has(me, P.ViewersBan)) out.push({ kind: "ban" });
  if (below && has(me, P.RolesAssign))
    for (const role of roles.filter((r) => !r.builtin && r.position < myRank).sort((a, b) => b.position - a.position))
      out.push({ kind: "role", role, assigned: (target.roles ?? []).includes(role.id) });
  if (below && has(me, P.RolesManage)) out.push({ kind: "permissions" });
  if (me.isHost && !target.isHost) {
    const i = coHosts.findIndex((c) => c.id === target.id);
    if (i < 0) out.push({ kind: "makeCoHost" });
    else {
      out.push({ kind: "removeCoHost" });
      if (i > 0) out.push({ kind: "moveUp" });
      if (i < coHosts.length - 1) out.push({ kind: "moveDown" });
    }
    if (target.connected !== false) out.push({ kind: "makeHost" });
  }
  return out;
}

/** What a role editor may do with a role (C-8.5). */
export function roleAccess(me: ViewerInfo | null, role: Role, roles: Role[]) {
  const myRank = me ? rankOf(me, roles) : 0;
  const manage = !!me && has(me, P.RolesManage);
  const editable = manage && role.id !== COHOST_ROLE && role.position < myRank;
  return {
    editable,
    /** Built-in roles keep their name, colour and rank; only the Viewer role's permissions change. */
    detailsEditable: editable && !role.builtin,
    deletable: editable && !role.builtin,
    /** Permissions you may grant: only ones you hold (removing others is fine). */
    grantable: (p: string) => !!me && has(me, p),
  };
}

/** Viewers whose latency is unknown show "–"; otherwise the §12 bands. */
export function latencyBand(rtt: number | null | undefined): "good" | "fair" | "poor" | null {
  if (rtt == null || !Number.isFinite(rtt)) return null;
  return rtt < 100 ? "good" : rtt <= 250 ? "fair" : "poor";
}
