const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

function cors(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Vary": "Origin"
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors(request))) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  return !!env.ADMIN_TOKEN && header === `Bearer ${env.ADMIN_TOKEN}`;
}

function newId() {
  return crypto.randomUUID();
}

async function log(env, postId, event, detail = "") {
  await env.DB.prepare(
    "INSERT INTO activity_log (post_id,event,detail) VALUES (?,?,?)"
  ).bind(postId, event, String(detail).slice(0, 1500)).run();
}

async function publishPagePost(post, env) {
  if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) {
    throw new Error("Missing META_PAGE_ID or META_PAGE_ACCESS_TOKEN secret.");
  }
  if (post.format === "reel") {
    throw new Error("Reels publishing is not implemented in this MVP. Use Meta Business Suite.");
  }

  const version = env.META_GRAPH_VERSION || "v27.0";
  const base = `https://graph.facebook.com/${version}/${env.META_PAGE_ID}`;

  let endpoint, body;
  if (post.format === "photo") {
    if (!post.media_url || !/^https:\/\/.+/i.test(post.media_url)) {
      throw new Error("Photo post requires a public HTTPS media_url.");
    }
    endpoint = `${base}/photos`;
    body = new URLSearchParams({
      url: post.media_url,
      caption: post.caption,
      access_token: env.META_PAGE_ACCESS_TOKEN
    });
  } else {
    endpoint = `${base}/feed`;
    body = new URLSearchParams({
      message: post.caption,
      access_token: env.META_PAGE_ACCESS_TOKEN
    });
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error(result.error?.message || `Meta API returned HTTP ${response.status}`);
  }
  return result.id || result.post_id || JSON.stringify(result);
}

async function processDuePosts(env) {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT * FROM posts
     WHERE destination='page' AND status='scheduled'
       AND scheduled_at <= ?
     ORDER BY scheduled_at ASC LIMIT 5`
  ).bind(now).all();

  for (const post of results || []) {
    try {
      const platformId = await publishPagePost(post, env);
      await env.DB.prepare(
        `UPDATE posts SET status='published', published_at=?, platform_post_id=?,
         error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(new Date().toISOString(), platformId, post.id).run();
      await log(env, post.id, "published", platformId);
    } catch (err) {
      await env.DB.prepare(
        `UPDATE posts SET status='failed', error_message=?,
         updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(String(err.message || err), post.id).run();
      await log(env, post.id, "failed", err.message || err);
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request);
    }

    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return withCors(json({ ok: true, service: "UMAY AI SOCIAL AUTOMATION", time: new Date().toISOString() }), request);
    }
     
    
    if (url.pathname.startsWith("/media/") && request.method === "GET") {
      const key = decodeURIComponent(url.pathname.slice(7));

      if (!key || key.includes("..") || key.includes("/")) {
        return withCors(json({ error: "Invalid image key." }, 400), request);
      }

      const object = await env.IMAGES.get(key);

      if (!object) {
        return withCors(json({ error: "Image not found." }, 404), request);
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Cache-Control", "public, max-age=31536000");
      headers.set("Access-Control-Allow-Origin", "*");

      return new Response(object.body, { headers });
    }

    if (url.pathname === "/api/generate-image" && request.method === "POST") {
      if (!authorized(request, env)) {
        return withCors(json({ error: "Unauthorized." }, 401), request);
      }

      if (!env.AI) {
        return withCors(json({ error: "Workers AI binding AI is missing." }, 503), request);
      }

      const data = await request.json().catch(() => null);
      const topic = String(data?.topic || "").trim();
      const niche = String(data?.niche || "general").trim();

      if (!topic) {
        return withCors(json({ error: "Enter an image topic." }, 400), request);
      }

      const prompt = `Photorealistic cinematic editorial photograph. Subject: ${topic}. Niche: ${niche}. Square composition, professional photography, realistic details, dramatic natural lighting. No text, logo or watermark.`;

      try {
        const result = await env.AI.run(
          "@cf/black-forest-labs/flux-1-schnell",
          { prompt, steps: 4 }
        );

        
        if (!result?.image) {
          throw new Error("Image model returned no image.");
        }

        if (!env.IMAGES) {
          throw new Error("R2 binding IMAGES is missing.");
        }

        const binary = Uint8Array.from(
          atob(result.image),
          c => c.charCodeAt(0)
        );

        const key = crypto.randomUUID() + ".jpg";

        await env.IMAGES.put(key, binary, {
          httpMetadata: {
            contentType: "image/jpeg"
          }
        });

        const mediaUrl = new URL(
          "/media/" + key,
          request.url
        ).toString();

        return withCors(json({
          image: "data:image/jpeg;base64," + result.image,
          media_url: mediaUrl,
          key
        }), request);


        return withCors(json({
          image: "data:image/jpeg;charset=utf-8;base64," + result.image
        }), request);

      } catch (err) {
        return withCors(json({
          error: String(err.message || err)
        }, 502), request);
      }
    }
    if (url.pathname === "/api/generate" && request.method === "POST") {
            if (!authorized(request, env)) {
        return withCors(json({ error: "Unauthorized." }, 401), request);
      }
      if (!env.AI) {
        return withCors(json({ error: "Workers AI binding AI is missing." }, 503), request);
      }

      const data = await request.json().catch(() => null);
      const topic = String(data?.topic || "").trim();

      if (!topic) {
        return withCors(json({ error: "Enter a topic." }, 400), request);
      }

      const language = String(data.language || "English").slice(0, 40);
      const niche = String(data.niche || "general").slice(0, 100);
      const tone = String(data.tone || "engaging and informative").slice(0, 80);

      const prompt = [
        "Write one original Facebook Page post in " + language + ".",
        "Niche: " + niche,
        "Topic: " + topic,
        "Tone: " + tone,
        "Requirements:",
        "- Start with a strong hook.",
        "- Provide useful and accurate information.",
        "- Use short mobile-friendly paragraphs.",
        "- Add a natural call to action where appropriate.",
        "- Add 3 to 5 relevant hashtags.",
        "- Never invent statistics or sources.",
        "- Return only the finished post."
      ].join("\n");

      try {
        const result = await env.AI.run("@cf/qwen/qwen3.8-27b", {
          messages: [
            {
              role: "system",
              content: "You are a professional social media content writer."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_completion_tokens: 1200,
reasoning_effort: "low",
chat_template_kwargs: {
  enable_thinking: false
},
temperature: 0.8
        });

        const rawCaption =
  result?.response ??
  result?.choices?.[0]?.message?.content ??
  result?.result?.response ??
  result?.output_text ??
  "";

const caption = (
  typeof rawCaption === "string"
    ? rawCaption
    : JSON.stringify(rawCaption)
).trim();

if (!caption) {
  throw new Error(
    "AI response diagnostic: " +
    JSON.stringify(result?.choices?.[0] ?? result).slice(0, 1500)
  );
}

        return withCors(json({ caption }), request);

      } catch (err) {
        return withCors(json({
          error: String(err.message || err)
        }, 502), request);
      }
    }

    if (!authorized(request, env)) {
      return withCors(json({ error: "Unauthorized. Configure ADMIN_TOKEN and send a Bearer token." }, 401), request);
    }
if (url.pathname === "/api/activity" && request.method === "GET") {
  const { results } = await env.DB.prepare(
    `SELECT
       activity_log.id,
       activity_log.post_id,
       activity_log.event,
       activity_log.detail,
       activity_log.created_at,
       posts.destination,
       posts.format,
       posts.caption
     FROM activity_log
     LEFT JOIN posts
       ON posts.id = activity_log.post_id
     ORDER BY activity_log.created_at DESC,
              activity_log.id DESC
     LIMIT 100`
  ).all();

  return withCors(json({
    activities: results || []
  }), request);
}
    if (url.pathname === "/api/posts" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM posts ORDER BY created_at DESC LIMIT 100"
      ).all();
      return withCors(json({ posts: results || [] }), request);
    }

    if (url.pathname === "/api/posts" && request.method === "POST") {
      const data = await request.json().catch(() => null);
      if (!data || !["page","profile"].includes(data.destination) ||
          !["text","photo","reel"].includes(data.format) ||
          typeof data.caption !== "string" || !data.caption.trim()) {
        return withCors(json({ error: "Invalid payload. Provide destination, format and caption." }, 400), request);
      }
      const id = newId();
      const manual = data.destination === "profile" || data.format === "reel";
      const status = manual ? "manual_required" : "draft";
      await env.DB.prepare(
        `INSERT INTO posts (id,destination,format,caption,media_url,status)
         VALUES (?,?,?,?,?,?)`
      ).bind(id, data.destination, data.format, data.caption.trim(),
        data.media_url || null, status).run();
      await log(env, id, "created", status);
      return withCors(json({ id, status, note: manual ? "Manual publishing required." : "Draft created." }, 201), request);
    }

    const approveMatch = url.pathname.match(/^\/api\/posts\/([a-f0-9-]+)\/approve$/i);
    if (approveMatch && request.method === "POST") {
      const id = approveMatch[1];
      const data = await request.json().catch(() => ({}));
      const post = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(id).first();
      if (!post) return withCors(json({ error: "Post not found." }, 404), request);
      if (post.destination !== "page" || post.format === "reel") {
        return withCors(json({ error: "This item requires manual publishing in Facebook/Meta Business Suite." }, 409), request);
      }
      const scheduledAt = data.scheduled_at ? new Date(data.scheduled_at) : new Date(Date.now() + 60000);
      if (Number.isNaN(scheduledAt.getTime())) {
        return withCors(json({ error: "Invalid scheduled_at date." }, 400), request);
      }
      await env.DB.prepare(
        `UPDATE posts SET status='scheduled', scheduled_at=?,
         error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(scheduledAt.toISOString(), id).run();
      await log(env, id, "scheduled", scheduledAt.toISOString());
      return withCors(json({ id, status: "scheduled", scheduled_at: scheduledAt.toISOString() }), request);
    }

    return withCors(json({ error: "Not found." }, 404), request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(processDuePosts(env));
  }
};
