/**
 * Type declarations for xactions package
 * 
 * xactions@3.1.0 has type definitions but incomplete package.json exports mapping.
 * This file provides the necessary type information for TypeScript.
 */

declare module 'xactions' {
  export class Scraper {
    constructor();
    login(username: string, password: string, email?: string): Promise<void>;
    isLoggedIn(): Promise<boolean>;
    logout(): Promise<void>;
    getProfile(username: string): Promise<Profile>;
    getCookies(): Promise<CookieEntry[]>;
    setCookies(cookies: CookieEntry[] | string): Promise<void>;
    // Add other methods as needed
  }

  export interface Profile {
    name: string;
    username: string;
    bio: string;
    location?: string;
    website?: string;
    joinDate?: string;
    followers: number;
    following: number;
    tweets: number;
    verified: boolean;
    avatar?: string;
    header?: string;
  }

  export interface CookieEntry {
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }

  export enum SearchMode {
    Latest = 'Latest',
    Top = 'Top',
    Photos = 'Photos',
    Videos = 'Videos',
    Users = 'Users',
  }

  export class ScraperError extends Error {
    code: string;
    details?: Record<string, any>;
  }
  export class AuthenticationError extends ScraperError {}
  export class RateLimitError extends ScraperError {
    retryAfter?: number;
  }
  export class NotFoundError extends ScraperError {}
  export class TwitterApiError extends ScraperError {
    httpStatus: number;
    twitterErrorCode?: number;
    endpoint?: string;
  }
}
