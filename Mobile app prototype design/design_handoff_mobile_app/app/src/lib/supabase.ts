import 'react-native-url-polyfill/auto';

import { createClient, processLock } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

/**
 * The same Supabase project the web portal talks to, so the app inherits the
 * portal's RLS rather than re-deciding who may see what.
 *
 * The publishable key is public by design — it ships in the portal's browser
 * bundle too. Row-level security is what protects the data.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
      'Copy .env.example to .env and fill in the values from the portal.',
  );
}

/**
 * Session storage backed by the device keystore.
 *
 * SecureStore refuses values over about 2KB and a Supabase session is larger
 * than that once the JWT grows, so values are split across numbered slots with
 * a count written to the base key. Everything stays inside the keystore — the
 * refresh token never touches plain AsyncStorage.
 */
const CHUNK = 1800;

const chunkKey = (key: string, index: number) => `${key}.${index}`;

async function clearChunks(key: string) {
  const countRaw = await SecureStore.getItemAsync(key);
  const count = Number(countRaw);
  if (!Number.isFinite(count)) return;
  for (let index = 0; index < count; index += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, index));
  }
}

const LargeSecureStore = {
  async getItem(key: string) {
    const countRaw = await SecureStore.getItemAsync(key);
    const count = Number(countRaw);
    if (!Number.isFinite(count) || count <= 0) return null;

    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, index));
      // A missing slot means the write was interrupted; treat the whole value
      // as absent rather than handing back a truncated session.
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string) {
    await clearChunks(key);
    const count = Math.ceil(value.length / CHUNK);
    for (let index = 0; index < count; index += 1) {
      await SecureStore.setItemAsync(
        chunkKey(key, index),
        value.slice(index * CHUNK, (index + 1) * CHUNK),
      );
    }
    await SecureStore.setItemAsync(key, String(count));
  },

  async removeItem(key: string) {
    await clearChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * SecureStore has no web implementation. The shipped product is iOS and
 * Android; `npm run web` exists to review the design in a browser, so it falls
 * back to localStorage there rather than failing to boot. Never rely on this
 * path for anything a real user signs into.
 */
const storage = Platform.OS === 'web' ? undefined : LargeSecureStore;

export const supabase = createClient(url, key, {
  auth: {
    storage,
    persistSession: true,
    autoRefreshToken: true,
    // No URL to parse on a device — this is a browser-only concern.
    detectSessionInUrl: false,
    // Keeps concurrent refreshes from racing when several screens wake at once.
    lock: processLock,
  },
});

/**
 * Refresh in the foreground only. Left running in the background the timer
 * fires against a suspended socket and burns retries.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

export const supabaseUrl = url;
