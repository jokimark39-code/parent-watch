import { supabase } from "./supabase";

// English + romanized gambling keywords
const EN_KEYWORDS = [
  "slot", "slots", "casino", "bet", "betting", "poker", "roulette",
  "jackpot", "gamble", "gambling", "777", "baccarat", "blackjack",
  "spin", "wager", "lucky", "fortune", "vegas", "lotto", "lottery",
  "keno", "sicbo", "fishing king", "shan koe mee", "shwe",
];

// Burmese gambling keywords
const MY_KEYWORDS = [
  "လောင်းကစား", "စလော့", "ကာစီနို", "ဘောလုံးလောင်း",
  "ဂျပိုးကြီး", "အန်စာတုံး", "ရှင်ကိုးမီး", "ကတ်ပြား",
];

// Never-flag safelist (well-known non-gambling packages)
const SAFELIST_PKG = new Set([
  "com.google.android.youtube",
  "com.facebook.katana",
  "com.facebook.orca",
  "com.android.chrome",
  "com.google.android.gm",
  "com.android.settings",
  "com.android.dialer",
  "com.google.android.apps.photos",
  "com.instagram.android",
  "com.whatsapp",
  "com.zhiliaoapp.musically",
  "com.viber.voip",
  "org.telegram.messenger",
]);

const SAFELIST_NAME = new Set([
  "youtube", "messenger", "facebook", "chrome", "gallery",
  "settings", "phone", "gmail", "photos", "instagram", "whatsapp",
  "tiktok", "telegram", "viber",
]);

export type RiskClassification = "SAFE" | "NEEDS_REVIEW" | "LIKELY_GAMBLING" | "HIGH_RISK";

export interface RiskResult {
  score: number;
  classification: RiskClassification;
  reasons: string[];
}

export interface AppLike {
  app_name?: string | null;
  package_name?: string | null;
  icon_path?: string | null;
  local_risk_score?: number | null;
  local_classification?: string | null;
  risk_reasons?: unknown;
}

function hasAny(text: string, list: string[]): string | null {
  const t = text.toLowerCase();
  for (const k of list) if (t.includes(k.toLowerCase())) return k;
  return null;
}

export function isSafelisted(app: AppLike): boolean {
  const pkg = (app.package_name || "").toLowerCase();
  if (SAFELIST_PKG.has(pkg)) return true;
  const name = (app.app_name || "").toLowerCase().trim();
  if (SAFELIST_NAME.has(name)) return true;
  return false;
}

export function classifyApp(app: AppLike): RiskResult {
  const reasons: string[] = [];
  let score = 0;

  const name = app.app_name || "";
  const pkg = app.package_name || "";

  const nameHit = hasAny(name, EN_KEYWORDS);
  if (nameHit) { score += 40; reasons.push(`App name contains "${nameHit}"`); }

  const pkgHit = hasAny(pkg, EN_KEYWORDS);
  if (pkgHit) { score += 30; reasons.push(`Package name contains "${pkgHit}"`); }

  const myHit = hasAny(name, MY_KEYWORDS) || hasAny(pkg, MY_KEYWORDS);
  if (myHit) { score += 50; reasons.push(`Burmese gambling keyword: "${myHit}"`); }

  const cls = (app.local_classification || "").toUpperCase();
  if (cls === "HIGH_RISK") { score += 50; reasons.push("Android local classification: HIGH_RISK"); }
  else if (cls === "LIKELY_GAMBLING") { score += 40; reasons.push("Android local classification: LIKELY_GAMBLING"); }
  else if (cls === "NEEDS_REVIEW") { score += 20; reasons.push("Android local classification: NEEDS_REVIEW"); }

  const local = Number(app.local_risk_score ?? 0);
  if (local > 0) {
    const add = Math.round(local * 0.5);
    score += add;
    reasons.push(`Android local risk score: ${local}`);
  }

  if (Array.isArray(app.risk_reasons) && app.risk_reasons.length > 0) {
    for (const r of app.risk_reasons.slice(0, 3)) {
      if (typeof r === "string") reasons.push(r);
    }
  }

  if (score > 100) score = 100;

  let classification: RiskClassification = "SAFE";
  if (score >= 80) classification = "HIGH_RISK";
  else if (score >= 60) classification = "LIKELY_GAMBLING";
  else if (score >= 30) classification = "NEEDS_REVIEW";

  return { score, classification, reasons };
}

function severityFor(c: RiskClassification): "HIGH" | "MEDIUM" | "LOW" | null {
  if (c === "HIGH_RISK" || c === "LIKELY_GAMBLING") return "HIGH";
  if (c === "NEEDS_REVIEW") return "MEDIUM";
  return null;
}

// Embed a machine-readable tag in the alert description so we can dedupe.
function pkgTag(pkg: string, deviceId?: string | null) {
  return `[pkg:${pkg}${deviceId ? `|dev:${deviceId}` : ""}]`;
}

const DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Scan installed apps + recent usage events, insert dedup'd alerts. */
export async function scanAndCreateAlerts(parentId: string) {
  const sinceIso = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const usageSince = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();

  const [appsR, usageR, alertsR] = await Promise.all([
    supabase.from("installed_apps").select("*"),
    supabase
      .from("usage_events")
      .select("device_id,package_name,app_name,opened_at")
      .gte("opened_at", usageSince)
      .order("opened_at", { ascending: false })
      .limit(500),
    supabase
      .from("alerts")
      .select("id,description,created_at,alert_type")
      .eq("alert_type", "SUSPICIOUS_APP")
      .gte("created_at", sinceIso),
  ]);

  if (appsR.error || usageR.error || alertsR.error) {
    return {
      inserted: 0,
      error: appsR.error?.message || usageR.error?.message || alertsR.error?.message,
    };
  }

  const apps = appsR.data ?? [];
  const usage = usageR.data ?? [];
  const recent = alertsR.data ?? [];

  // Build recent dedupe set from tags in description
  const alertedTags = new Set<string>();
  for (const a of recent) {
    const desc: string = a.description || "";
    const m = desc.match(/\[pkg:([^\]|]+)(?:\|dev:([^\]]+))?\]/);
    if (m) alertedTags.add(`${m[1]}|${m[2] ?? ""}`);
  }

  // Index installed_apps by device_id + package_name for enrichment
  const appIndex = new Map<string, any>();
  for (const a of apps) {
    if (!a.package_name) continue;
    appIndex.set(`${a.device_id ?? ""}|${a.package_name}`, a);
  }

  // Candidates: recent opened apps + any installed app (in case not yet opened but risky)
  type Cand = { device_id: string | null; package_name: string; app_name?: string | null; source: any };
  const seen = new Set<string>();
  const candidates: Cand[] = [];

  for (const u of usage) {
    if (!u.package_name) continue;
    const key = `${u.device_id ?? ""}|${u.package_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const enrich = appIndex.get(key);
    candidates.push({
      device_id: u.device_id ?? null,
      package_name: u.package_name,
      app_name: u.app_name ?? enrich?.app_name ?? null,
      source: enrich ?? u,
    });
  }
  for (const a of apps) {
    if (!a.package_name) continue;
    const key = `${a.device_id ?? ""}|${a.package_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      device_id: a.device_id ?? null,
      package_name: a.package_name,
      app_name: a.app_name,
      source: a,
    });
  }

  const inserts: any[] = [];
  for (const c of candidates) {
    const appLike: AppLike = {
      app_name: c.app_name ?? c.source?.app_name,
      package_name: c.package_name,
      icon_path: c.source?.icon_path,
      local_risk_score: c.source?.local_risk_score,
      local_classification: c.source?.local_classification,
      risk_reasons: c.source?.risk_reasons,
    };
    if (isSafelisted(appLike)) continue;

    const r = classifyApp(appLike);
    const sev = severityFor(r.classification);
    if (!sev) continue;

    const dedupeKey = `${c.package_name}|${c.device_id ?? ""}`;
    if (alertedTags.has(dedupeKey)) continue;
    alertedTags.add(dedupeKey);

    const displayName = appLike.app_name || c.package_name;
    inserts.push({
      parent_id: parentId,
      device_id: c.device_id,
      alert_type: "SUSPICIOUS_APP",
      severity: sev,
      title: `Suspicious app opened: ${displayName}`,
      description:
        `${displayName} (${c.package_name}) — risk ${r.score} / ${r.classification}. ` +
        `Reasons: ${r.reasons.join("; ") || "keyword match"} ${pkgTag(c.package_name, c.device_id)}`,
      is_read: false,
    });
  }

  if (inserts.length === 0) return { inserted: 0 };
  const { error } = await supabase.from("alerts").insert(inserts);
  return { inserted: inserts.length, error: error?.message };
}

/** Parse the [pkg:...] tag we embed in alert descriptions. */
export function parseAlertTag(description?: string | null): { pkg?: string; device_id?: string } {
  if (!description) return {};
  const m = description.match(/\[pkg:([^\]|]+)(?:\|dev:([^\]]+))?\]/);
  if (!m) return {};
  return { pkg: m[1], device_id: m[2] };
}

/** Strip our embedded tag from the description for display. */
export function cleanDescription(description?: string | null): string {
  if (!description) return "";
  return description.replace(/\s*\[pkg:[^\]]+\]\s*/g, "").trim();
}
