import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Cfg = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
const encKey = (k: string) => k.split("/").map(encodeURIComponent).join("/");
async function presign(cfg: Cfg, method: string, key: string, ttl: number) {
  const aws = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: "auto" });
  const url = new URL(`https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${encKey(key)}`);
  url.searchParams.set("X-Amz-Expires", String(ttl));
  return (await aws.sign(new Request(url, { method }), { aws: { signQuery: true } })).url;
}
const DAY = 24 * 3600;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const body = await req.json();
    const { data: rows } = await admin.from("app_private").select("key,value");
    const priv: Record<string, string> = Object.fromEntries((rows || []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const cfg: Cfg | null = priv.r2_account_id && priv.r2_access_key_id && priv.r2_secret && priv.r2_bucket
      ? { accountId: priv.r2_account_id, accessKeyId: priv.r2_access_key_id, secretAccessKey: priv.r2_secret, bucket: priv.r2_bucket } : null;

    // ---------- Rappel envoyé par le serveur de conversion (GitHub) ----------
    if (body.action === "callback") {
      const { data: job } = await admin.from("encode_jobs").select("*").eq("id", body.job).maybeSingle();
      if (!job || job.token !== body.token) return json({ error: "Tâche inconnue." }, 403);
      if (job.status === "done") return json({ ok: true });
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.status === "running") Object.assign(patch, { status: "running", progress: Number(body.progress) || 0, step: body.step || null });
      if (body.status === "error") Object.assign(patch, { status: "error", error: String(body.error || "Erreur").slice(0, 300) });
      if (body.status === "done") {
        Object.assign(patch, { status: "done", progress: 1, step: null, size: body.size || 0, duration: body.duration || null });
        const table = job.target_type === "movie" ? "titles" : "episodes";
        const { data: target } = await admin.from(table).select("*").eq("id", job.target_id).maybeSingle();
        if (target) {
          const upd: Record<string, unknown> = { video_key: job.out_key, video_size: body.size || 0, duration: body.duration || null };
          if (body.has_sub && job.sub_key) upd.subtitle_key = job.sub_key;
          if (body.has_thumb) {
            if (job.target_type === "episode" && !target.thumb_key) upd.thumb_key = job.thumb_key;
            if (job.target_type === "movie" && !target.backdrop_key) upd.backdrop_key = job.thumb_key;
          }
          await admin.from(table).update(upd).eq("id", job.target_id);
          // supprime l'ancienne vidéo remplacée et le fichier source (MKV)
          const old = [target.video_key && target.video_key !== job.out_key ? target.video_key : null, job.src_key].filter(Boolean) as string[];
          if (cfg) for (const k of old) await fetch(await presign(cfg, "DELETE", k, 300), { method: "DELETE" }).catch(() => {});
        } else if (cfg) {
          // la fiche a été supprimée entre-temps : on nettoie tout
          for (const k of [job.src_key, job.out_key, job.thumb_key, job.sub_key].filter(Boolean)) await fetch(await presign(cfg, "DELETE", k, 300), { method: "DELETE" }).catch(() => {});
        }
      }
      await admin.from("encode_jobs").update(patch).eq("id", job.id);
      return json({ ok: true });
    }

    // ---------- Actions de l'admin ----------
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: "Non connecté." }, 401);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "Réservé à l'administrateur." }, 403);
    if (!cfg) return json({ error: "Stockage non configuré." }, 400);

    const dispatch = async (job: Record<string, any>) => {
      const ghToken = priv.gh_token; const repo = priv.gh_repo || "ZeynZer/blourr-encoder";
      if (!ghToken) throw new Error("Jeton GitHub manquant (Profil → Conversion).");
      const inputs = {
        job: job.id, token: job.token,
        cb: `${Deno.env.get("SUPABASE_URL")}/functions/v1/encode`,
        src: await presign(cfg, "GET", job.src_key, 2 * DAY),
        out: await presign(cfg, "PUT", job.out_key, 2 * DAY),
        thumb: await presign(cfg, "PUT", job.thumb_key, 2 * DAY),
        sub: job.sub_key ? await presign(cfg, "PUT", job.sub_key, 2 * DAY) : "",
        opts: JSON.stringify({ ...job.options, kind: job.target_type }),
      };
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/encode.yml/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "blourr" },
        body: JSON.stringify({ ref: "main", inputs }),
      });
      if (r.status !== 204) {
        const t = await r.text();
        throw new Error(r.status === 401 || r.status === 403 ? "GitHub refuse le jeton : vérifie qu'il a « Actions : Read and write » sur blourr-encoder." : r.status === 404 ? "Dépôt ou fichier de conversion introuvable sur GitHub." : `GitHub : ${r.status} ${t.slice(0, 120)}`);
      }
    };

    if (body.action === "create") {
      const { target_type, target_id, src_key, src_size, options, label } = body;
      if (!["movie", "episode"].includes(target_type) || !target_id || typeof src_key !== "string" || !src_key.startsWith("c/")) return json({ error: "Requête invalide." }, 400);
      const v = Date.now().toString(36);
      const base = target_type === "movie" ? `c/${target_id}/video_${v}` : `c/${body.title_id}/e/${target_id}_${v}`;
      const job = {
        created_by: u.user.id, target_type, target_id, label: label || null, src_key, src_size: src_size || 0,
        out_key: `${base}.mp4`, thumb_key: `${base}_t.jpg`, sub_key: options?.subs === "fr" ? `${base}.vtt` : null,
        options: { quality: options?.quality || "source", fps: options?.fps || "source", langs: options?.langs || "both", subs: options?.subs || "none" },
        token: crypto.randomUUID() + crypto.randomUUID(),
      };
      const { data: created, error } = await admin.from("encode_jobs").insert(job).select().single();
      if (error) return json({ error: error.message }, 500);
      try { await dispatch(created); } catch (e) {
        await admin.from("encode_jobs").update({ status: "error", error: (e as Error).message }).eq("id", created.id);
        return json({ error: (e as Error).message }, 502);
      }
      return json({ ok: true, id: created.id });
    }

    if (body.action === "retry") {
      const { data: job } = await admin.from("encode_jobs").select("*").eq("id", body.id).maybeSingle();
      if (!job) return json({ error: "Tâche introuvable." }, 404);
      const fresh = crypto.randomUUID() + crypto.randomUUID();
      await admin.from("encode_jobs").update({ status: "queued", progress: 0, error: null, step: null, token: fresh, updated_at: new Date().toISOString() }).eq("id", job.id);
      try { await dispatch({ ...job, token: fresh }); } catch (e) {
        await admin.from("encode_jobs").update({ status: "error", error: (e as Error).message }).eq("id", job.id);
        return json({ error: (e as Error).message }, 502);
      }
      return json({ ok: true });
    }

    if (body.action === "cancel") {
      const { data: job } = await admin.from("encode_jobs").select("*").eq("id", body.id).maybeSingle();
      if (!job) return json({ ok: true });
      if (job.status !== "done") for (const k of [job.src_key, job.out_key, job.thumb_key, job.sub_key].filter(Boolean)) await fetch(await presign(cfg, "DELETE", k, 300), { method: "DELETE" }).catch(() => {});
      await admin.from("encode_jobs").delete().eq("id", job.id);
      return json({ ok: true });
    }

    if (body.action === "test") {
      const ghToken = priv.gh_token; const repo = priv.gh_repo || "ZeynZer/blourr-encoder";
      if (!ghToken) return json({ ok: false, error: "Aucun jeton enregistré." });
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/encode.yml`, {
        headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "User-Agent": "blourr" },
      });
      return json({ ok: r.ok, error: r.ok ? null : `GitHub répond ${r.status}` });
    }

    return json({ error: "Action inconnue." }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
