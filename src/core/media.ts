// File matching for local playlist items (spec §13.3–13.5), invite links (§11) and YouTube ids (§14.13).
// Ports of MediaMatch.cs, InviteLink.cs and YouTube.cs, with the same tests.
import type { Item } from "./protocol";

/** A file on this device. Only its name and duration are ever shared. */
export interface LocalFile {
  key: string;
  name: string;
  duration: number | null;
  file?: File;
}

export type MatchKind = "match" | "likelyMatch" | "mismatch";

export const tolerance = (hostDuration: number) => Math.max(2, hostDuration * 0.005);

export const durationMatches = (host: number | null, local: number | null) =>
  host !== null && local !== null && Math.abs(host - local) <= tolerance(host);

/** Ignores case and extension, and treats runs of whitespace, '.', '_' and '-' as one space. */
export function normaliseName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  const stem = ext.length > 1 && ext.length <= 6 && !ext.includes(" ") ? name.slice(0, dot) : name;
  return stem
    .toLowerCase()
    .split(/[\s._-]+/)
    .filter(Boolean)
    .join(" ");
}

export const nameMatches = (a: string, b: string) => normaliseName(a) === normaliseName(b);

export function compare(hostItem: Item, file: LocalFile): MatchKind {
  const nameOk = nameMatches(hostItem.name, file.name);
  if (hostItem.duration === null || file.duration === null) return nameOk ? "match" : "mismatch";
  return durationMatches(hostItem.duration, file.duration) ? (nameOk ? "match" : "likelyMatch") : "mismatch";
}

/** Maps local items to candidate files: duration first, then name; each file used once; existing mappings kept. */
export function autoMap(items: Item[], candidates: LocalFile[], existing: Map<string, LocalFile> = new Map()): Map<string, LocalFile> {
  const map = new Map<string, LocalFile>();
  const used = new Set<string>();
  const local = items.filter((i) => i.kind === "local");
  for (const item of local) {
    const kept = existing.get(item.id);
    if (kept) {
      map.set(item.id, kept);
      used.add(kept.key);
    }
  }
  const score = (item: Item, f: LocalFile) => {
    const n = nameMatches(item.name, f.name);
    const d = durationMatches(item.duration, f.duration);
    return d && n ? 3 : d ? 2 : n ? 1 : 0;
  };
  const gap = (item: Item, f: LocalFile) =>
    item.duration !== null && f.duration !== null ? Math.abs(item.duration - f.duration) : Infinity;
  const pairs = local
    .filter((i) => !map.has(i.id))
    .flatMap((item) => candidates.map((file) => ({ item, file, s: score(item, file), g: gap(item, file) })))
    .filter((p) => p.s > 0)
    .sort((a, b) => b.s - a.s || a.g - b.g);
  for (const { item, file } of pairs) {
    if (map.has(item.id) || used.has(file.key)) continue;
    map.set(item.id, file);
    used.add(file.key);
  }
  return map;
}

/** A–Z with numbers compared by value ("EP 2" before "EP 10"), ignoring case. */
export const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

export const MEDIA_EXTENSIONS = new Set(
  ".mkv .mp4 .m4v .avi .mov .webm .wmv .flv .ts .m2ts .mts .mpg .mpeg .ogv .3gp .vob .divx .rmvb .mp3 .flac .m4a .aac .ogg .opus .wav".split(
    " ",
  ),
);

export function isMediaFile(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && MEDIA_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

// ---- YouTube -----------------------------------------------------------------------------------

/** The 11-character video id from a YouTube link or a bare id, or null. Same rules as the theatre. */
export function youTubeId(v: string): string | null {
  const s = v.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m =
    /^https:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#/].*)?$/.exec(
      s,
    );
  return m?.[1] ?? null;
}

export const youTubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// ---- Invite links ------------------------------------------------------------------------------

export const DIRECTORY_JOIN = "https://kino-directory.srie.workers.dev/join";

export interface InviteLink {
  theatreId: string;
  code: string;
}

/** Same normalisation as the theatre: upper case, and Crockford look-alikes I→1, L→1, O→0. */
export const normaliseCode = (code: string) => code.trim().toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0");

/** Parses kino://join/t/CODE, https://…/join#t/CODE, a web-app link (https://…/#t/CODE) or "t/CODE". */
export function parseInvite(text: string | null | undefined): InviteLink | null {
  if (!text?.trim()) return null;
  const m = /^(?:kino:\/\/join\/|https:\/\/[^/#?\s]+\/(?:join\/?)?#\/?|#\/?|)([a-zA-Z][a-zA-Z0-9-]{1,30})\/([0-9A-Za-z]{6})\/?$/.exec(
    text.trim(),
  );
  if (!m) return null;
  const code = normaliseCode(m[2]!);
  return /^[0-9A-HJKMNP-TV-Z]{6}$/.test(code) ? { theatreId: m[1]!.toLowerCase(), code } : null;
}

export const appLink = (l: InviteLink) => `kino://join/${l.theatreId}/${l.code}`;
export const webLink = (l: InviteLink) => `${DIRECTORY_JOIN}#${l.theatreId}/${l.code}`;

/** Reads a local file's duration with a throwaway <video>. */
export function probeDuration(file: File, timeoutMs = 15_000): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (d: number | null) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration * 1000) / 1000 : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}
