/**
 * PumpFun Channel Bot — Channel publisher
 *
 * Sends cards to the Telegram channel. Messages are sanitised and fitted to
 * Telegram's limits; transient failures (429 with retry_after, 5xx, network
 * errors) are retried, while anything else (bad request, bot removed from the
 * channel) fails at once so the caller can log it.
 */

import { GrammyError, HttpError } from 'grammy';

import { log } from './logger.js';
import { fitToLimit, sanitiseHtml, TELEGRAM_CAPTION_LIMIT, TELEGRAM_TEXT_LIMIT, visibleLength } from './telegram-html.js';

/** The part of grammy's Api the publisher uses. */
export interface ChannelApi {
    sendMessage(chatId: string, text: string, other: { parse_mode: 'HTML'; link_preview_options: { is_disabled: boolean } }): Promise<unknown>;
    sendPhoto(chatId: string, photo: string, other: { caption: string; parse_mode: 'HTML' }): Promise<unknown>;
}

export interface PublisherOptions {
    maxRetries?: number;
    /** Longest wait honoured for a 429 retry_after, in ms; longer waits fail instead. */
    maxRetryDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
}

/** A card: an optional image and its HTML caption. */
export interface Card {
    imageUrl: string | null;
    caption: string;
}

/** Delay before retrying `err`, or null when it is not worth retrying. */
export function retryDelayMs(err: unknown, attempt: number): number | null {
    if (err instanceof GrammyError) {
        if (err.error_code === 429) return ((err.parameters.retry_after ?? 1) + 1) * 1000;
        if (err.error_code >= 500) return (attempt + 1) * 2000;
        return null;
    }
    if (err instanceof HttpError) return (attempt + 1) * 2000;
    return null;
}

export class ChannelPublisher {
    private readonly maxRetries: number;
    private readonly maxRetryDelayMs: number;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(private readonly api: ChannelApi, private readonly channelId: string, options: PublisherOptions = {}) {
        this.maxRetries = options.maxRetries ?? 3;
        this.maxRetryDelayMs = options.maxRetryDelayMs ?? 60_000;
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }

    /** Post a text message, trimmed to Telegram's length limit. Throws when it cannot be sent. */
    async postText(html: string): Promise<void> {
        const text = fitToLimit(sanitiseHtml(html), TELEGRAM_TEXT_LIMIT);
        await this.withRetry(() => this.api.sendMessage(this.channelId, text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
        }));
    }

    /**
     * Post a card as a photo with caption when it has an image and the caption
     * fits, otherwise (or if the photo is rejected) as a text message.
     */
    async postCard(card: Card): Promise<void> {
        const caption = sanitiseHtml(card.caption);
        if (!card.imageUrl || visibleLength(caption) > TELEGRAM_CAPTION_LIMIT) {
            await this.postText(caption);
            return;
        }
        try {
            await this.withRetry(() => this.api.sendPhoto(this.channelId, card.imageUrl!, { caption, parse_mode: 'HTML' }));
        } catch (err) {
            log.warn('Photo send failed, falling back to text: %s', err);
            await this.postText(caption);
        }
    }

    private async withRetry<T>(send: () => Promise<T>): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            try {
                return await send();
            } catch (err) {
                const delay = retryDelayMs(err, attempt);
                if (delay === null || attempt >= this.maxRetries || delay > this.maxRetryDelayMs) throw err;
                log.warn('Telegram send failed (%s), retry %d/%d in %dms', err instanceof Error ? err.message : err, attempt + 1, this.maxRetries, delay);
                await this.sleep(delay);
            }
        }
    }
}
