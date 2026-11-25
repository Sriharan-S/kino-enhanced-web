// Chat helpers (spec §18): input cleaning, GIF links and GIPHY search. Port of Kino.Core.Chat, same rules as the theatre.
import type { Gif } from "./protocol";

export const CHAT_MAX_CHARS = 500;
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👏", "🎉"] as const;
/** At most this many reactions float over the video at once. */
export const MAX_FLOATING_REACTIONS = 6;
export const REACTION_MS = 3000;

/** What the theatre will accept: trimmed, control characters dropped (newlines kept), blank-line runs collapsed. */
export function cleanChatText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Same allow list as the theatre: https GIF links from GIPHY, Tenor or KLIPY media hosts, default port, no user info. */
export function isGifLink(text: string): boolean {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    !u.port &&
    (/^media[0-9]?\.giphy\.com$/.test(u.hostname) ||
      ["i.giphy.com", "media.tenor.com", "c.tenor.com", "static.klipy.com"].includes(u.hostname))
  );
}

/** One GIPHY result: a small preview for the picker, and the GIF to send. */
export interface GifResult {
  previewUrl: string;
  gif: Gif;
}

interface Rendition {
  url?: string;
  width?: string;
  height?: string;
}

interface GiphyResponse {
  data?: {
    title?: string;
    images?: { fixed_height?: Rendition; fixed_width?: Rendition; fixed_width_small?: Rendition; original?: Rendition };
  }[];
}

const toInt = (s: string | undefined) => {
  const n = s ? parseInt(s, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function parseGiphy(response: GiphyResponse | null | undefined): GifResult[] {
  const out: GifResult[] = [];
  for (const d of response?.data ?? []) {
    const preview = d.images?.fixed_width_small ?? d.images?.fixed_width;
    const send = d.images?.fixed_height ?? d.images?.original;
    if (!preview?.url || !send?.url || !isGifLink(send.url)) continue;
    out.push({
      previewUrl: preview.url,
      gif: {
        url: send.url,
        width: toInt(send.width),
        height: toInt(send.height),
        title: d.title?.trim() ? d.title.trim().slice(0, 100) : null,
      },
    });
  }
  return out;
}

/** GIPHY search, called from the browser: GIF traffic never touches the theatre (§18, §20). Needs the user's own key. */
export async function searchGiphy(apiKey: string, query: string, signal?: AbortSignal): Promise<GifResult[]> {
  const q = new URLSearchParams({ api_key: apiKey, limit: "24", rating: "pg-13" });
  const kind = query.trim() ? "search" : "trending";
  if (kind === "search") {
    q.set("q", query.trim());
    q.set("lang", "en");
  }
  const res = await fetch(`https://api.giphy.com/v1/gifs/${kind}?${q}`, { signal });
  if (res.status === 401 || res.status === 403) throw new Error("GIPHY didn't accept that API key.");
  if (!res.ok) throw new Error(`GIPHY search failed (${res.status}).`);
  return parseGiphy((await res.json()) as GiphyResponse);
}

/** A GIF link pasted into chat, sent as a GIF (no key needed). */
export function gifFromLink(url: string): Gif {
  return { url: url.trim(), width: null, height: null, title: null };
}
