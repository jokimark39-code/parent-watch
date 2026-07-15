import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  apps: z
    .array(
      z.object({
        package_name: z.string(),
        app_name: z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(80),
});

export type AiRiskLevel = "HIGH" | "MEDIUM" | "SAFE";

export type AiRiskItem = {
  package_name: string;
  risk: AiRiskLevel;
  reason: string;
};

export const classifyAppsWithAi = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<{ results: AiRiskItem[]; error?: string }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { results: [], error: "LOVABLE_API_KEY not configured" };

    const listText = data.apps
      .map((a, i) => `${i + 1}. name="${a.app_name ?? ""}" package="${a.package_name}"`)
      .join("\n");

    const system =
      "You are a strict content-safety classifier for Android apps. " +
      "Given app name and package, decide if the app is a gambling / slot / casino / betting / lottery / poker / jackpot / money-game app. " +
      "Include Burmese gambling apps (ရှင်ကိုးမီး, ဂျပိုးကြီး, etc.), fake-name gambling apps (random package like com.fhf.xxx with name 'classic slot' = HIGH), and 777/lucky-spin style. " +
      "Respond ONLY as compact JSON: {\"results\":[{\"package_name\":\"...\",\"risk\":\"HIGH|MEDIUM|SAFE\",\"reason\":\"short reason\"}, ...]}. " +
      "HIGH = clearly gambling/slot/casino/betting. MEDIUM = suspicious/unclear/lookalike. SAFE = normal apps (social, tools, games without wagering).";

    const user = `Classify these ${data.apps.length} apps:\n${listText}`;

    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": key,
        },
        body: JSON.stringify({
          model: "google/gemini-3.5-flash",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!r.ok) {
        const text = await r.text();
        return { results: [], error: `AI gateway ${r.status}: ${text.slice(0, 200)}` };
      }

      const j: any = await r.json();
      const content: string = j?.choices?.[0]?.message?.content ?? "";
      let parsed: any = {};
      try {
        parsed = JSON.parse(content);
      } catch {
        const m = content.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }
      const raw: any[] = Array.isArray(parsed?.results) ? parsed.results : [];
      const results: AiRiskItem[] = raw
        .map((x) => {
          const risk = String(x?.risk ?? "").toUpperCase();
          const level: AiRiskLevel =
            risk === "HIGH" ? "HIGH" : risk === "MEDIUM" ? "MEDIUM" : "SAFE";
          return {
            package_name: String(x?.package_name ?? ""),
            risk: level,
            reason: String(x?.reason ?? "").slice(0, 240),
          };
        })
        .filter((x) => x.package_name);
      return { results };
    } catch (e: any) {
      return { results: [], error: e?.message ?? "AI request failed" };
    }
  });
