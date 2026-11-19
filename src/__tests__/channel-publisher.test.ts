import { GrammyError, HttpError } from 'grammy';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { ChannelPublisher, retryDelayMs, type ChannelApi } from '../channel-publisher.js';

vi.mock('../logger.js', () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function apiError(code: number, retryAfter?: number): GrammyError {
    return new GrammyError(`Call failed (${code})`, {
        ok: false,
        error_code: code,
        description: `error ${code}`,
        ...(retryAfter !== undefined ? { parameters: { retry_after: retryAfter } } : {}),
    }, 'sendMessage', {});
}

type SendMessage = Mock<ChannelApi['sendMessage']>;
type SendPhoto = Mock<ChannelApi['sendPhoto']>;

function fakeApi(overrides: { sendMessage?: SendMessage; sendPhoto?: SendPhoto } = {}): { sendMessage: SendMessage; sendPhoto: SendPhoto } {
    return {
        sendMessage: overrides.sendMessage ?? vi.fn<ChannelApi['sendMessage']>().mockResolvedValue({}),
        sendPhoto: overrides.sendPhoto ?? vi.fn<ChannelApi['sendPhoto']>().mockResolvedValue({}),
    };
}

describe('retryDelayMs', () => {
    it('honours retry_after on 429', () => {
        expect(retryDelayMs(apiError(429, 7), 0)).toBe(8_000);
    });

    it('backs off on 5xx and network errors', () => {
        expect(retryDelayMs(apiError(502), 1)).toBe(4_000);
        expect(retryDelayMs(new HttpError('Network request failed', new Error('ECONNRESET')), 0)).toBe(2_000);
    });

    it('does not retry client errors or unknown failures, even if the text mentions 500', () => {
        expect(retryDelayMs(apiError(400), 0)).toBeNull();
        expect(retryDelayMs(apiError(403), 0)).toBeNull();
        expect(retryDelayMs(new Error('mint 5003 not found'), 0)).toBeNull();
    });
});

describe('ChannelPublisher', () => {
    const sleep = vi.fn().mockResolvedValue(undefined);

    it('retries a rate-limited send and then succeeds', async () => {
        const sendMessage = vi.fn<ChannelApi['sendMessage']>().mockRejectedValueOnce(apiError(429, 2)).mockResolvedValue({});
        const publisher = new ChannelPublisher(fakeApi({ sendMessage }), '@chan', { sleep });

        await publisher.postText('<b>hi</b>');

        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(3_000);
        expect(sendMessage).toHaveBeenLastCalledWith('@chan', '<b>hi</b>', { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    });

    it('gives up after maxRetries and surfaces the error', async () => {
        const sendMessage = vi.fn<ChannelApi['sendMessage']>().mockRejectedValue(apiError(503));
        const publisher = new ChannelPublisher(fakeApi({ sendMessage }), '@chan', { sleep, maxRetries: 2 });

        await expect(publisher.postText('x')).rejects.toBeInstanceOf(GrammyError);
        expect(sendMessage).toHaveBeenCalledTimes(3);
    });

    it('fails at once on a retry_after longer than it is willing to wait', async () => {
        const sendMessage = vi.fn<ChannelApi['sendMessage']>().mockRejectedValue(apiError(429, 3_600));
        const publisher = new ChannelPublisher(fakeApi({ sendMessage }), '@chan', { sleep });

        await expect(publisher.postText('x')).rejects.toBeInstanceOf(GrammyError);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('sends a short card as a photo and a long one as text', async () => {
        const api = fakeApi();
        const publisher = new ChannelPublisher(api, '@chan', { sleep });

        await publisher.postCard({ imageUrl: 'https://img.example/a.png', caption: 'short' });
        expect(api.sendPhoto).toHaveBeenCalledWith('@chan', 'https://img.example/a.png', { caption: 'short', parse_mode: 'HTML' });

        await publisher.postCard({ imageUrl: 'https://img.example/a.png', caption: 'x'.repeat(1_100) });
        expect(api.sendPhoto).toHaveBeenCalledTimes(1);
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('falls back to text when the photo is rejected', async () => {
        const api = fakeApi({ sendPhoto: vi.fn<ChannelApi['sendPhoto']>().mockRejectedValue(apiError(400)) });
        const publisher = new ChannelPublisher(api, '@chan', { sleep });

        await publisher.postCard({ imageUrl: 'https://img.example/broken.png', caption: '<b>card</b>' });

        expect(api.sendMessage).toHaveBeenCalledWith('@chan', '<b>card</b>', expect.anything());
    });

    it('trims an oversized text message to the Telegram limit', async () => {
        const api = fakeApi();
        const publisher = new ChannelPublisher(api, '@chan', { sleep });
        const lines = Array.from({ length: 300 }, (_, i) => `<b>line ${i}</b> ${'y'.repeat(20)}`);

        await publisher.postText(lines.join('\n'));

        const sent = api.sendMessage.mock.calls[0]![1];
        expect(sent.replace(/<[^>]+>/g, '').length).toBeLessThanOrEqual(4_096);
    });
});
