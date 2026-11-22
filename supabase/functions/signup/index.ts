import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const COLORS = ["#7c5cff", "#ff3d7f", "#22c55e", "#f59e0b", "#06b6d4", "#ef4444", "#a855f7", "#14b8a6", "#f97316", "#3b82f6"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const { email, password, name, code } = await req.json();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim().slice(0, 40);
    const cleanCode = String(code || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) return json({ error: "Adresse e-mail invalide." }, 400);
    if (String(password || "").length < 6) return json({ error: "Le mot de passe doit faire au moins 6 caractères." }, 400);
    if (!cleanName) return json({ error: "Indique ton prénom." }, 400);

    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
    const firstUser = !count;

    const { data: codeRow } = await admin.from("app_private").select("value").eq("key", "family_code").maybeSingle();
    if (!firstUser) {
      if (!codeRow?.value || cleanCode.toLowerCase() !== codeRow.value.toLowerCase()) {
        return json({ error: "Code famille incorrect. Demande-le à l'administrateur." }, 403);
      }
    } else if (cleanCode.length < 4) {
      return json({ error: "Premier compte : choisis un code famille (4 caractères minimum) que tu donneras à ta famille." }, 400);
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: cleanName },
    });
    if (error) {
      const msg = /already|registered|exists/i.test(error.message) ? "Un compte existe déjà avec cet e-mail." : error.message;
      return json({ error: msg }, 400);
    }
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const { error: pErr } = await admin.from("profiles").insert({
      id: created.user.id,
      display_name: cleanName,
      role: firstUser ? "admin" : "member",
      color,
    });
    if (pErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: pErr.message }, 500);
    }
    if (firstUser && !codeRow?.value) {
      await admin.from("app_private").upsert({ key: "family_code", value: cleanCode });
    }
    return json({ ok: true, admin: firstUser });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
