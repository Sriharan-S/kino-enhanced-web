// Kino protocol v1, client side. The authoritative spec and canonical examples live in the main repo:
// https://github.com/Sriharan-S/kino-enhanced/tree/main/protocol

export const PROTOCOL_VERSION = 1;

export interface Anchor {
  itemId: string | null;
  state: "playing" | "paused";
  position: number;
  rate: number;
  at: number;
  seq: number;
}

export const isPlaying = (a: Anchor) => a.state === "playing";

/** Expected media position (s) at theatre time `nowMs`. */
export function expectedAt(a: Anchor, nowMs: number): number {
  return !isPlaying(a) || nowMs <= a.at ? a.position : a.position + (a.rate * (nowMs - a.at)) / 1000;
}

export interface Item {
  id: string;
  kind: "local" | "url" | "youtube";
  name: string;
  duration: number | null;
  url?: string;
}

export type ViewerStatus = "sync" | "catching" | "buffering" | "mismatch" | "waiting" | "nofile";

export interface ViewerInfo {
  id: string;
  name: string;
  device: string | null;
  isHost: boolean;
  rtt: number | null;
  buffering: boolean;
  roles?: string[];
  coHost?: number | null;
  actingHost?: boolean;
  muted?: boolean;
  allow?: string[];
  deny?: string[];
  permissions?: string[];
  connected?: boolean;
  status?: ViewerStatus;
}

export const can = (v: ViewerInfo | null | undefined, permission: string) => !!v?.permissions?.includes(permission);
export const isTimelineAuthority = (v: ViewerInfo | null | undefined) => !!v && (v.isHost || !!v.actingHost);

export interface Role {
  id: string;
  name: string;
  colour: string | null;
  position: number;
  permissions: string[];
  builtin: boolean;
}

export interface ScreenInfo {
  code: string;
  name: string;
  visibility: "public" | "private";
  hidden?: boolean;
  maxViewers: number;
  showDevices: boolean;
  autoAdvance?: boolean;
  bufferingPolicy?: "keep" | "wait";
}

export interface CoHostInfo {
  id: string;
  name: string;
}

export interface Gif {
  url: string;
  width: number | null;
  height: number | null;
  title: string | null;
}

export interface ChatMessage {
  id: number;
  at: number;
  kind: "text" | "gif" | "system";
  from: string | null;
  name: string | null;
  text: string | null;
  gif: Gif | null;
}

export interface SubMeta {
  id: string;
  itemId: string;
  name: string;
  format: string;
  size: number;
  from: string;
  fromName: string;
}

export interface ReadyCheck {
  id: number;
  by: string;
  deadline: number;
  answers: Record<string, boolean>;
  done: boolean;
}

export interface Welcome {
  self: ViewerInfo;
  screen: ScreenInfo;
  viewers: ViewerInfo[];
  roles?: Role[];
  coHosts?: CoHostInfo[];
  playlist?: Item[];
  chat?: ChatMessage[];
  subs?: SubMeta[];
  ready?: ReadyCheck | null;
  hold?: string[] | null;
  item: Item | null;
  anchor: Anchor;
  serverTime: number;
}

export interface ServerError {
  code: string;
  message: string;
}

/** Theatre → client messages. Unknown types are ignored (forward compatibility). */
export type ServerMessage =
  | { type: "welcome"; data: Welcome }
  | { type: "pong"; data: { t0: number; ts: number } }
  | { type: "anchor"; data: Anchor }
  | { type: "item"; data: Item | null }
  | { type: "viewers"; data: ViewerInfo[] }
  | { type: "roles"; data: Role[] }
  | { type: "cohosts"; data: CoHostInfo[] }
  | { type: "screen"; data: ScreenInfo }
  | { type: "playlist"; data: Item[] }
  | { type: "chat"; data: ChatMessage }
  | { type: "react"; data: { from: string; name: string; emoji: string } }
  | { type: "subs"; data: SubMeta[] }
  | { type: "ready"; data: ReadyCheck | null }
  | { type: "hold"; data: string[] | null }
  | { type: "error"; data: ServerError };

export const KNOWN_TYPES = new Set([
  "welcome",
  "pong",
  "anchor",
  "item",
  "viewers",
  "roles",
  "cohosts",
  "screen",
  "playlist",
  "chat",
  "react",
  "subs",
  "ready",
  "hold",
  "error",
]);

/** Parses a message, or returns null for malformed or unknown ones. */
export function parseServerMessage(text: string): ServerMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null) return null;
  const { type, data } = m as { type?: unknown; data?: unknown };
  return typeof type === "string" && KNOWN_TYPES.has(type) ? ({ type, data } as ServerMessage) : null;
}

// ---- HTTP API

export interface TheatreInfo {
  id: string;
  name: string;
  protocol: number;
  minProtocol: number;
  status: string;
  time: number;
}

export interface LobbyScreen {
  code: string;
  name: string;
  visibility: "public" | "private";
  viewers: number;
  maxViewers: number;
  host: string | null;
}

export interface ResolveResponse {
  code: string;
  screenId: string;
  name: string;
  visibility: "public" | "private";
  requiresPassword: boolean;
}

export interface CreateScreenRequest {
  name: string;
  visibility: "public" | "private";
  password?: string;
  hidden?: boolean;
  maxViewers?: number;
}

export interface CreateScreenResponse {
  theatre: string;
  code: string;
  screenId: string;
  claim: string;
}

export const Permissions = {
  PlaybackToggle: "playback.toggle",
  PlaybackSeek: "playback.seek",
  PlaybackSkip: "playback.skip",
  PlaylistAdd: "playlist.add",
  PlaylistAddExternal: "playlist.add_external",
  PlaylistRemove: "playlist.remove",
  PlaylistReorder: "playlist.reorder",
  SubtitlesShare: "subtitles.share",
  ReadyCheck: "screen.ready_check",
  ScreenSettings: "screen.settings",
  ScreenInvite: "screen.invite",
  ChatSend: "chat.send",
  ChatGif: "chat.gif",
  ChatReact: "chat.react",
  ViewersMute: "viewers.mute",
  ViewersKick: "viewers.kick",
  ViewersBan: "viewers.ban",
  RolesAssign: "roles.assign",
  RolesManage: "roles.manage",
} as const;
