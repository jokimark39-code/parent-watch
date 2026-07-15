// External Supabase client — points at the parent project's existing Supabase.
// Publishable/anon key is safe to expose in the browser.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://alszphuivwbnxyxieamb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_KvUvtEZkPBX6yE_EvzSAZg_Gd8Z56ex";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    storageKey: "antislot-parent-auth",
  },
});

export const APP_ICONS_BUCKET = "app-icons";
