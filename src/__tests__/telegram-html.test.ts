import { describe, expect, it } from 'vitest';

import {
    esc,
    fitToLimit,
    link,
    safeHref,
    sanitiseHtml,
    TELEGRAM_TEXT_LIMIT,
    visibleLength,
} from '../telegram-html.js';

describe('esc', () => {
    it('escapes the characters that matter in Telegram HTML', () => {
        expect(esc('a<b>c & "d"')).toBe('a&lt;b&gt;c &amp; &quot;d&quot;');
        expect(esc('<script>alert("xss")</script>')).not.toContain('<script>');
    });

    it('leaves plain text and empty strings alone', () => {
        expect(esc('hello world')).toBe('hello world');
        expect(esc('')).toBe('');
    });
});

describe('safeHref', () => {
    it('accepts absolute http(s) URLs', () => {
        expect(safeHref('https://github.com/acme/repo')).toBe('https://github.com/acme/repo');
        expect(safeHref('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
    });

    it('adds https to a bare host, as GitHub blog fields often omit it', () => {
        expect(safeHref('example.com/blog')).toBe('https://example.com/blog');
    });

    it.each([
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        'tg://resolve?domain=evil',
        'data:text/html,<b>x</b>',
        'mailto:a@b.c',
        'not a url',
        'localhost',
        '',
        '   ',
    ])('rejects %j', (raw) => {
        expect(safeHref(raw)).toBeNull();
    });

    it('rejects null and undefined', () => {
        expect(safeHref(null)).toBeNull();
        expect(safeHref(undefined)).toBeNull();
    });
});

describe('link', () => {
    it('escapes the href so an attribute cannot be broken out of', () => {
        expect(link('https://x.com/a"onclick="b', 'label')).toBe('<a href="https://x.com/a%22onclick=%22b">label</a>');
    });

    it('returns only the label for an unsafe target', () => {
        expect(link('javascript:alert(1)', 'Website')).toBe('Website');
    });
});

describe('sanitiseHtml', () => {
    it('keeps recognised tags and escapes stray angle brackets', () => {
        expect(sanitiseHtml('<b>bold</b> 1 < 2 <tag>')).toBe('<b>bold</b> 1 &lt; 2 &lt;tag&gt;');
    });

    it('escapes everything when there are no recognised tags', () => {
        expect(sanitiseHtml('<x>')).toBe('&lt;x&gt;');
    });
});

describe('visibleLength', () => {
    it('counts text without tags and with entities as one character', () => {
        expect(visibleLength('<b>ab</b> &amp; <a href="https://e.com">c</a>')).toBe(6);
    });
});

describe('fitToLimit', () => {
    it('returns a message within the limit unchanged', () => {
        expect(fitToLimit('<b>short</b>', TELEGRAM_TEXT_LIMIT)).toBe('<b>short</b>');
    });

    it('drops whole trailing lines and marks the cut', () => {
        const lines = Array.from({ length: 200 }, (_, i) => `<b>line ${i}</b> ${'x'.repeat(30)}`);
        const fitted = fitToLimit(lines.join('\n'), TELEGRAM_TEXT_LIMIT);
        expect(visibleLength(fitted)).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
        expect(fitted.startsWith('<b>line 0</b>')).toBe(true);
        expect(fitted.endsWith('\n…')).toBe(true);
        expect(fitted.match(/<b>/g)?.length).toBe(fitted.match(/<\/b>/g)?.length);
    });

    it('falls back to escaped plain text when one line alone is too long', () => {
        const fitted = fitToLimit(`<i>${'y'.repeat(50)} &lt;</i>`, 20);
        expect(fitted).toBe(`${'y'.repeat(19)}…`);
        expect(visibleLength(fitted)).toBe(20);
    });
});
