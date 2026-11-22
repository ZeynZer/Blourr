import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const GET_TTL = 6 * 3600; // 6 h
const PUT_TTL = 6 * 3600;

type Cfg = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

const encKey = (k: string) => k.split("/").map(encodeURIComponent).join("/");

function asciiName(n: string) {
  return n.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}

async function presign(cfg: Cfg, method: string, key: string, ttl: number, extra: Record<string, string> = {}) {
  const aws = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: "auto" });
  const url = new URL(`https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${encKey(key)}`);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  url.searchParams.set("X-Amz-Expires", String(ttl));
  const signed = await aws.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return json({ error: "Non connecté." }, 401);
    const uid = u.user.id;
    const { data: profile } = await admin.from("profiles").select("role").eq("id", uid).maybeSingle();
    if (!profile) return json({ error: "Compte non autorisé." }, 403);
    const isAdmin = profile.role === "admin";

    const body = await req.json();
    const action = body.action as string;

    const { data: rows } = await admin.from("app_private").select("key,value");
    const priv: Record<string, string> = Object.fromEntries((rows || []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const cfg: Cfg | null = priv.r2_account_id && priv.r2_access_key_id && priv.r2_secret && priv.r2_bucket
      ? { accountId: priv.r2_account_id, accessKeyId: priv.r2_access_key_id, secretAccessKey: priv.r2_secret, bucket: priv.r2_bucket }
      : null;

    const canWrite = (key: string) => {
      if (typeof key !== "string" || key.includes("..") || key.length > 300) return false;
      if (key.startsWith(`g/${uid}/`)) return true;
      if (isAdmin && (key.startsWith("c/") || key.startsWith("g/"))) return true;
      return false;
    };

    switch (action) {
      case "status":
        return json({ configured: !!cfg, isAdmin });

      case "get-settings": {
        if (!isAdmin) return json({ error: "Réservé à l'administrateur." }, 403);
        return json({
          accountId: priv.r2_account_id || "",
          accessKeyId: priv.r2_access_key_id || "",
          hasSecret: !!priv.r2_secret,
          bucket: priv.r2_bucket || "",
          familyCode: priv.family_code || "",
        });
      }

      case "set-settings": {
        if (!isAdmin) return json({ error: "Réservé à l'administrateur." }, 403);
        const map: Record<string, string> = {
          accountId: "r2_account_id", accessKeyId: "r2_access_key_id", secretAccessKey: "r2_secret", bucket: "r2_bucket", familyCode: "family_code",
        };
        const upserts = [];
        for (const [k, col] of Object.entries(map)) {
          const v = body[k];
          if (typeof v === "string" && v.trim() !== "") upserts.push({ key: col, value: v.trim() });
        }
        if (upserts.length) {
          const { error } = await admin.from("app_private").upsert(upserts);
          if (error) return json({ error: error.message }, 500);
        }
        return json({ ok: true });
      }

      case "test": {
        if (!isAdmin) return json({ error: "Réservé à l'administrateur." }, 403);
        if (!cfg) return json({ ok: false, error: "Identifiants incomplets." });
        const key = `c/_test_${crypto.randomUUID()}.txt`;
        const put = await fetch(await presign(cfg, "PUT", key, 300), { method: "PUT", body: "blourr" });
        if (!put.ok) return json({ ok: false, error: `Écriture refusée (${put.status}). Vérifie l'Account ID, les clés et le nom du bucket.` });
        const get = await fetch(await presign(cfg, "GET", key, 300));
        const txt = await get.text();
        await fetch(await presign(cfg, "DELETE", key, 300), { method: "DELETE" });
        return json({ ok: get.ok && txt === "blourr" });
      }

      case "sign-put": {
        if (!cfg) return json({ error: "Stockage non configuré." }, 400);
        const keys: string[] = body.keys || [];
        const urls: Record<string, string> = {};
        for (const k of keys) {
          if (!canWrite(k)) return json({ error: "Envoi non autorisé." }, 403);
          urls[k] = await presign(cfg, "PUT", k, PUT_TTL);
        }
        return json({ urls });
      }

      case "sign-get": {
        if (!cfg) return json({ error: "Stockage non configuré." }, 400);
        const keys: string[] = (body.keys || []).slice(0, 500);
        const downloads: Record<string, string> = body.downloads || {};
        const urls: Record<string, string> = {};
        for (const k of keys) {
          if (typeof k !== "string" || !(k.startsWith("g/") || k.startsWith("c/"))) continue;
          const extra: Record<string, string> = {};
          if (downloads[k]) {
            const n = String(downloads[k]).slice(0, 180);
            extra["response-content-disposition"] = `attachment; filename="${asciiName(n)}"; filename*=UTF-8''${encodeURIComponent(n)}`;
          }
          urls[k] = await presign(cfg, "GET", k, GET_TTL, extra);
        }
        return json({ urls, ttl: GET_TTL });
      }

      case "delete": {
        if (!cfg) return json({ ok: true });
        const keys: string[] = (body.keys || []).filter(Boolean);
        for (const k of keys) {
          if (!canWrite(k)) continue;
          await fetch(await presign(cfg, "DELETE", k, 300), { method: "DELETE" });
        }
        return json({ ok: true });
      }

      case "members": {
        if (!isAdmin) return json({ error: "Réservé à l'administrateur." }, 403);
        const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
        const { data: profs } = await admin.from("profiles").select("*").order("created_at");
        const emails = Object.fromEntries((list?.users || []).map((x) => [x.id, x.email]));
        return json({ members: (profs || []).map((p) => ({ ...p, email: emails[p.id] || "" })) });
      }

      case "set-role": {
        if (!isAdmin) return json({ error: "Réservé à l'administrateur." }, 403);
        if (body.userId === uid) return json({ error: "Tu ne peux pas changer ton propre rôle." }, 400);
        const role = body.role === "admin" ? "admin" : "member";
        await admin.from("profiles").update({ role }).eq("id", body.userId);
        return json({ ok: true });
      }

      case "remove-member": {
        if (!isAdmin) return json({ error: "Réservé à l'administrateur." }, 403);
        if (body.userId === uid) return json({ error: "Tu ne peux pas te supprimer toi-même." }, 400);
        const { error } = await admin.auth.admin.deleteUser(body.userId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      default:
        return json({ error: "Action inconnue." }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
