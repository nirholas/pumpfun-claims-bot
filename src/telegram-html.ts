/**
 * Telegram HTML helpers.
 *
 * Every card is sent with parse_mode HTML, and most of its text comes from
 * places the bot does not control: token names and links chosen by the coin
 * creator, GitHub bios, API responses. Text is escaped, links are limited to
 * http(s), and messages are fitted to Telegram's length limits so a hostile or
 * oversized field can neither inject markup nor make the send fail.
 */

/** Telegram's limit for a text message, counted after entity parsing. */
export const TELEGRAM_TEXT_LIMIT = 4096;
/** Telegram's limit for a photo caption, counted after entity parsing. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

/** Escape text for Telegram HTML (element content and double-quoted attributes). */
export function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * A link target that is safe to put in an href: an absolute http(s) URL, or a
 * bare host such as "example.com" (GitHub blog fields often omit the scheme).
 * Anything else (javascript:, tg:, data:, relative paths, junk) returns null.
 */
export function safeHref(raw: string | null | undefined): string | null {
    const value = raw?.trim();
    if (!value) return null;
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
    const candidate = hasScheme ? value : `https://${value}`;
    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.href;
}

/**
 * An HTML link around `labelHtml` (already escaped), or just the label when the
 * target is not a safe http(s) URL.
 */
export function link(raw: string | null | undefined, labelHtml: string): string {
    const href = safeHref(raw);
    return href ? `<a href="${esc(href)}">${labelHtml}</a>` : labelHtml;
}

/**
 * Escape stray `<` / `>` that are not part of a recognised Telegram tag. A last
 * line of defence for markup built elsewhere; card builders escape their input.
 * Recognised tags: b, strong, i, em, u, ins, s, strike, del, span, tg-spoiler,
 * a, code, pre, blockquote, tg-emoji.
 */
const TG_TAG_RE = /<\/?\s*(?:b|strong|i|em|u|ins|s|strike|del|span|tg-spoiler|a|code|pre|blockquote|tg-emoji)\b[^>]*>/gi;

export function sanitiseHtml(html: string): string {
    const escapeGap = (gap: string) => gap.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let out = '';
    let cursor = 0;
    for (const match of html.matchAll(new RegExp(TG_TAG_RE.source, 'gi'))) {
        out += escapeGap(html.slice(cursor, match.index)) + match[0];
        cursor = match.index + match[0].length;
    }
    return out + escapeGap(html.slice(cursor));
}

/** Length of the text Telegram will display: tags removed, entities decoded. */
export function visibleLength(html: string): number {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&(?:lt|gt|amp|quot|#\d+|#x[0-9a-f]+);/gi, '_')
        .length;
}

/**
 * Fit a message to `limit` visible characters by dropping whole lines from the
 * end. Card builders keep every tag on one line, so the result stays balanced.
 */
export function fitToLimit(html: string, limit: number): string {
    if (visibleLength(html) <= limit) return html;
    const marker = '…';
    const lines = html.split('\n');
    while (lines.length > 1 && visibleLength(lines.join('\n')) + 1 + marker.length > limit) {
        lines.pop();
    }
    const kept = lines.join('\n');
    if (visibleLength(kept) + 1 + marker.length <= limit) return `${kept}\n${marker}`;
    // A single line longer than the limit: fall back to plain text.
    const plain = kept.replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return esc(plain.slice(0, limit - marker.length) + marker);
}
