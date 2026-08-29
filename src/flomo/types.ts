export type FlomoMemo = {
  slug: string;
  content?: string;
  tags?: unknown;
  files?: unknown;
  pin?: unknown;
  linked_count?: unknown;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type FlomoFile = {
  id?: number | string;
  url?: string;
  thumbnail_url?: string;
};

export type TokenRecord = {
  access_token: string;
  user: {
    id: string | null;
    name: string | null;
    email: string | null;
  };
  saved_at: string;
};

export type MemoCache = {
  latest_updated_at: number;
  latest_slug: string;
  synced_at: number;
  memos: Record<string, FlomoMemo>;
};

export type FlomoCredentials = {
  accessToken: string | null;
  account: string | null;
  password: string | null;
};

export const WEB_BASE = 'https://v.flomoapp.com';
export const API_V1 = 'https://flomoapp.com/api/v1';
export const API_V2 = 'https://flomoapp.com/api/v2';

export const v1 = (apiPath: string) => `${API_V1}${apiPath}`;
export const v2 = (apiPath: string) => `${API_V2}${apiPath}`;

export function emptyMemoCache(): MemoCache {
  return { latest_updated_at: 0, latest_slug: '', synced_at: 0, memos: {} };
}
