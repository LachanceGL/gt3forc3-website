export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // Triggered manually (by visiting the URL in a browser) after an admin
    // has approved a "Get Verified" request — looks the person up by
    // Discord username within the server, then DMs them a confirmation.
    // Protected by a secret so this can't be triggered by anyone who just
    // finds the URL; not exposed anywhere in the site's HTML/JS.
    if (url.pathname === "/discord/notify-verified" && request.method === "GET") {
      const corsHeaders = { "Access-Control-Allow-Origin": "*" };

      const providedSecret = url.searchParams.get("secret");
      if (!env.ADMIN_SECRET || providedSecret !== env.ADMIN_SECRET) {
        return new Response("Forbidden", { status: 403, headers: corsHeaders });
      }

      const username = (url.searchParams.get("username") || "").trim();
      if (!username) {
        return new Response("Missing ?username=", { status: 400, headers: corsHeaders });
      }

      const GUILD_ID = "906573991492349962";

      try {
        const searchRes = await fetch(
          `https://discord.com/api/v10/guilds/${GUILD_ID}/members/search?query=${encodeURIComponent(username)}&limit=5`,
          { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
        );
        if (!searchRes.ok) {
          throw new Error("Member search failed: " + searchRes.status);
        }
        const results = await searchRes.json();

        const exact = results.find(
          m => m.user && m.user.username && m.user.username.toLowerCase() === username.toLowerCase()
        );
        const match = exact || results[0];

        if (!match || !match.user) {
          return new Response(`No member found matching "${username}"`, { status: 404, headers: corsHeaders });
        }

        const userId = match.user.id;

        const dmChannelRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
          method: "POST",
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ recipient_id: userId })
        });
        if (!dmChannelRes.ok) {
          throw new Error("Could not open DM channel: " + dmChannelRes.status);
        }
        const dmChannel = await dmChannelRes.json();

        const messageRes = await fetch(
          `https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              content: "✅ You've been verified on GT3FORC3.COM!\nYour Verified Driver badge is now live on the Leaderboard."
            })
          }
        );

        if (!messageRes.ok) {
          throw new Error("Could not send DM: " + messageRes.status);
        }

        return new Response(
          `Sent verification DM to ${match.user.username} (matched from query "${username}").`,
          { headers: { ...corsHeaders, "Content-Type": "text/plain" } }
        );
      } catch (err) {
        return new Response("Failed: " + err.message, { status: 502, headers: corsHeaders });
      }
    }

    // "Get Verified" form submissions. Sends a DM (via the bot) to a fixed
    // admin Discord user with the driver's details — the bot token never
    // reaches the browser, and the target user ID is kept server-side too,
    // not exposed in the site's HTML/JS.
    if (url.pathname === "/discord/verify-request" && request.method === "POST") {
      const ADMIN_USER_ID = "148119339847909376";

      let body;
      try {
        body = await request.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid request body" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const clean = (val, maxLen) => String(val || "").trim().slice(0, maxLen);
      const discordUsername = clean(body.discordUsername, 100);
      const driverName = clean(body.driverName, 100);
      const nationality = clean(body.nationality, 60);
      const track = clean(body.track, 50);
      const message = clean(body.message, 500);

      if (!discordUsername || !driverName || !track) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      try {
        const dmChannelRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
          method: "POST",
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ recipient_id: ADMIN_USER_ID })
        });

        if (!dmChannelRes.ok) {
          throw new Error("Could not open DM channel: " + dmChannelRes.status);
        }
        const dmChannel = await dmChannelRes.json();

        const messageRes = await fetch(
          `https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              embeds: [{
                title: "New Verification Request",
                color: 0xff9900,
                fields: [
                  { name: "In-Game Driver Name", value: driverName },
                  { name: "Nationality", value: nationality || "—" },
                  { name: "Track", value: track },
                  { name: "Discord", value: discordUsername },
                  { name: "Message", value: message || "—" }
                ],
                timestamp: new Date().toISOString()
              }]
            })
          }
        );

        if (!messageRes.ok) {
          throw new Error("Could not send DM: " + messageRes.status);
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Failed to submit request" }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // Contact form relay for forc3mod.com. The site POSTs the form here and
    // this writes it into the FORC3MOD contact channel using the bot token,
    // so the public (static) site never needs a webhook URL or a token of
    // its own. Same reasoning as /discord/stats and /discord/verify-request.
    //
    // NOTE FOR THIS REPO: this route serves forc3mod.com, NOT gt3forc3.com.
    // It is the reason this file is shared between two projects — see
    // docs/ARCHITECTURE.md. Nothing in this repo calls it; do not delete it
    // as dead code, and never paste this file over the live Worker without
    // checking the dashboard first.
    if (url.pathname === "/contact" && request.method === "POST") {
      const CONTACT_CHANNEL_ID = "1534649367573827879";

      let body;
      try {
        body = await request.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid request body" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const clean = (val, maxLen) => String(val || "").trim().slice(0, maxLen);
      const name = clean(body.name, 100);
      const email = clean(body.email, 150);
      const type = clean(body.type, 60);
      // Capped well under Discord's 4096-char embed description limit.
      const message = clean(body.message, 1500);

      if (!name || !email || !type || !message) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      try {
        const messageRes = await fetch(
          `https://discord.com/api/v10/channels/${CONTACT_CHANNEL_ID}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              // Required: without this someone can type @everyone into a
              // public form and have the bot fire it for them.
              allowed_mentions: { parse: [] },
              embeds: [{
                title: `New contact message — ${type}`,
                // Message goes in description (4096 cap), NOT a field (1024
                // cap) - a long message in a field makes Discord return 400.
                description: message,
                color: 0x2f6fff,
                fields: [
                  { name: "Name", value: name, inline: true },
                  { name: "Email", value: email, inline: true }
                ],
                timestamp: new Date().toISOString()
              }]
            })
          }
        );

        if (!messageRes.ok) {
          throw new Error("Could not post contact message: " + messageRes.status);
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Failed to deliver message" }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // Discord server stats (member count + online count + live per-track
    // player counts), fetched server-side using the bot token so it's
    // never exposed to the browser.
    if (url.pathname === "/discord/stats") {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);
      const cachedRes = await cache.match(cacheKey);
      if (cachedRes) return cachedRes;

      const GUILD_ID = "906573991492349962";
      const discordRes = await fetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}?with_counts=true`,
        { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
      );

      if (!discordRes.ok) {
        return new Response(JSON.stringify({ error: "Discord API error", status: discordRes.status }), {
          status: discordRes.status,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const guild = await discordRes.json();

      const PLAYER_COUNT_CHANNEL_ID = "1522784231611437261";
      // Maps a track id (matching LEADERBOARDS in index.html) to the exact
      // `trackName` string the bot uses for that server in GAME_SERVERS
      // (index.js) — kept in sync with the 2026-08-09 server reshuffle
      // (see that repo's docs/ROADMAP.md). Track id keys themselves stay
      // stable across reshuffles (redbullring/lagunaseca/spa keep their
      // original names even though the server behind them changed) so
      // share keys and URLs in index.html don't break — only the value
      // here, and LEADERBOARDS' displayName/title in index.html, change.
      const TRACK_KEYWORDS = {
        nordschleife: "EVO Nordschleife – HOT LAP",
        redbullring: "EVO Nürburgring GP – RACE", // server3 (fr...:60795), was Red Bull Ring
        lagunaseca: "EVO Spa Francorchamps – HOT LAP", // server4 (ca...:10648), was (guessed) Laguna Seca
        spa: "EVO Nürburgring – TOURING", // server2 (de8...:60350), was Spa Francorchamps
        nurburgringtour: "EVO Nürburgring – TOURING (H Shifter)" // server5 (fr...:60785)
      };

      const serverPlayers = {};
      try {
        const messagesRes = await fetch(
          `https://discord.com/api/v10/channels/${PLAYER_COUNT_CHANNEL_ID}/messages?limit=20`,
          { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
        );
        if (messagesRes.ok) {
          const messages = await messagesRes.json();
          for (const [trackId, keyword] of Object.entries(TRACK_KEYWORDS)) {
            for (const msg of messages) {
              // endsWith, not includes: "EVO Nürburgring – TOURING" is a
              // prefix of "EVO Nürburgring – TOURING (H Shifter)"'s title,
              // so a loose substring match would let the shorter keyword
              // accidentally match the wrong (nurburgringtour) server.
              const embed = (msg.embeds || []).find(e => (e.title || "").endsWith(keyword));
              if (!embed) continue;
              const text = JSON.stringify(embed);
              const match = text.match(/(\d+)\s*Players?\s*Online/i);
              if (match) {
                serverPlayers[trackId] = parseInt(match[1], 10);
                break;
              }
            }
          }
        }
      } catch (err) {
        // If this fails, just omit server player counts — member/online
        // counts above still work fine independently.
      }

      const stats = {
        member_count: guild.approximate_member_count ?? null,
        online_count: guild.approximate_presence_count ?? null,
        server_players: serverPlayers
      };

      const response = new Response(JSON.stringify(stats), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=120"
        }
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // Route based on a /server1/... or /server2/... prefix.
    // Everything after the prefix is forwarded as-is to the matching backend.
    let targetHost;
    let forwardPath;
    let useApiKey = false;
    let apiKeyName = "ASSETTO_API_KEY";

    if (url.pathname.startsWith("/server5/")) {
      targetHost = "https://fr.assettohosting.com:60785";
      forwardPath = url.pathname.replace("/server5", "");
      useApiKey = forwardPath.startsWith("/api/v1/");
      apiKeyName = "ASSETTO_API_KEY_5";
    } else if (url.pathname.startsWith("/server4/")) {
      targetHost = "https://ca.assettohosting.com:10648";
      forwardPath = url.pathname.replace("/server4", "");
      useApiKey = forwardPath.startsWith("/api/v1/");
      apiKeyName = "ASSETTO_API_KEY_4";
    } else if (url.pathname.startsWith("/server3/")) {
      targetHost = "https://fr.assettohosting.com:60795";
      forwardPath = url.pathname.replace("/server3", "");
      useApiKey = forwardPath.startsWith("/api/v1/");
      apiKeyName = "ASSETTO_API_KEY_3";
    } else if (url.pathname.startsWith("/server2/")) {
      targetHost = "https://de8.assettohosting.com:60350";
      forwardPath = url.pathname.replace("/server2", "");
      useApiKey = forwardPath.startsWith("/api/v1/");
      apiKeyName = "ASSETTO_API_KEY_2";
    } else if (url.pathname.startsWith("/server1/")) {
      targetHost = "https://ca.assettohosting.com:10647";
      forwardPath = url.pathname.replace("/server1", "");
      useApiKey = forwardPath.startsWith("/api/v1/");
    } else {
      // Backwards compatibility: unprefixed paths go to server 1, same as before.
      targetHost = "https://ca.assettohosting.com:10647";
      forwardPath = url.pathname;
      useApiKey = forwardPath.startsWith("/api/v1/");
    }

    const apiUrl = `${targetHost}${forwardPath}${url.search}`;

    const headers = {};
    if (useApiKey) {
      headers["Authorization"] = `Bearer ${env[apiKeyName]}`;
    }

    // Edge-cache the proxied response where the upstream data allows it.
    // Without this, every visitor re-fetched everything from
    // AssettoHosting on every visit, which is what made the Nordschleife
    // board so slow: the site's driver-nationality/flag pass walks every
    // session results file ONE AT A TIME (deliberately — parallel bursts
    // were failing on some mobile networks, see index.html), and server1
    // alone has 815 of them at ~316ms each ≈ 4.7 minutes cold. Those
    // files are immutable, so almost all of that is re-fetching bytes
    // that provably cannot have changed. Same caches.default pattern
    // /discord/stats above already uses.
    const cacheControl = request.method === "GET" ? cacheControlFor(forwardPath) : null;
    const cache = caches.default;
    let cacheKey = null;
    if (cacheControl) {
      cacheKey = new Request(url.toString(), request);
      const cachedRes = await cache.match(cacheKey);
      if (cachedRes) return cachedRes;
    }

    const res = await fetch(apiUrl, { headers });
    const data = await res.text();

    const responseHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    };

    // Only ever cache a genuine success. Caching a 401/500 would pin an
    // upstream outage in place for the whole TTL — and for a session
    // file that TTL is 30 days, which would turn a momentary blip into a
    // month of missing driver data with no way to flush it from here.
    const cacheable = Boolean(cacheControl) && res.status === 200;
    if (cacheable) responseHeaders["Cache-Control"] = cacheControl;

    const response = new Response(data, {
      status: res.status,
      headers: responseHeaders
    });

    // waitUntil so the cache write doesn't delay the response itself.
    // .clone() because a Response body can only be consumed once, and the
    // browser needs this one.
    if (cacheable) ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  }
}

// How long a given proxied upstream path may be cached, as a
// Cache-Control value — or null for "always go to origin".
//
// This doubles as the browser's cache policy, not just Cloudflare's,
// since it's sent on the response: a returning visitor serves the
// immutable session files straight from disk cache without a request at
// all, which is where the repeat-visit win comes from.
function cacheControlFor(forwardPath) {
  // An individual session's results file. Once that session is over its
  // file never changes again — the filename encodes the session's own
  // timestamp (results_20260706_234049_qualify), so a later session is
  // always a NEW url rather than a rewrite of this one. That's what
  // makes hard-caching safe, and this is the entry that actually
  // matters: it's ~99% of the site's cold-load time.
  //
  // "Once that session is over" is doing real work in that sentence
  // though — see isSettledSessionFile(). A file for a session that is
  // still running can still grow, and pinning a partial one for 30 days
  // would silently drop those drivers from the nationality counts with
  // no way to flush it from this repo.
  const sessionFile = forwardPath.match(/^\/api\/v1\/results\/(.+)$/);
  if (sessionFile) {
    return isSettledSessionFile(sessionFile[1])
      ? "public, max-age=2592000, immutable" // 30 days
      : "public, max-age=300";               // 5 min, still-moving target
  }

  // The index of those files, which does grow — a new entry appears
  // whenever a session ends. Short TTL: being a minute late to notice a
  // brand-new session only delays that session's drivers appearing in
  // the nationality counts, and the next visit picks them up.
  if (forwardPath === "/api/v1/results") {
    return "public, max-age=60";
  }

  // The public leaderboard rows. This board is described in the site's
  // own UI as "Ranks updated every new session", so it was never
  // real-time — but it IS the number a driver refreshes to see their own
  // new lap on, so keep the window short enough to feel immediate.
  // Under load (a busy race night) this also collapses every concurrent
  // viewer into one origin fetch per window, which matters more than the
  // per-visitor saving: Nordschleife's board is 1,581 rows / 268KB and
  // takes AssettoHosting ~1.6s to generate.
  if (/^\/leaderboards\/embed\/[^/]+\/rows$/.test(forwardPath)) {
    return "public, max-age=30";
  }

  // Anything else (live session state, /api/v1/* control endpoints,
  // anything added later) goes to origin every time. Deliberately a
  // whitelist, not a blacklist — a new upstream endpoint should have to
  // opt IN to being cached rather than silently inherit a TTL that might
  // be wrong for it.
  return null;
}

// Is this session's results file old enough that it's certainly final?
//
// Deliberately coarse, but NOT for the reason originally written here.
//
// This used to say the window existed to absorb an unknown timezone
// offset, on the assumption each server stamped filenames in its own
// local time. That was wrong, and was checked properly on 2026-08-26:
// the filenames are UTC. The listing's `timestamp` carries an explicit
// Z, matches the filename exactly, and lines up with real UTC (the
// newest session read 14 minutes old against both a system clock and
// the origin's own HTTP Date header). /rows' SessionDate is the UTC
// date too, confirmed across a midnight boundary — a session at
// 00:28Z on the 27th reports 2026-08-27, not the 26th.
//
// So there is no offset to absorb. The window is still worth keeping
// for a different reason: the filename records when a session STARTED,
// and a long practice session on a persistent server can still be
// running (and its file still growing) well after that. 2 days is
// comfortably longer than any session run here.
//
// That means this could safely be tightened — a few hours would do —
// letting recent files reach the 30-day cache sooner. Low value, and it
// needs a Worker deploy, so it hasn't been changed.
//
// The cost of being coarse here is close to zero: on the 815-file
// Nordschleife server all but the newest handful are far older than
// this, so ~99% still get the 30-day cache. The cost of being wrong the
// other way is a month of stale driver data, so this errs hard toward
// caution — an unparseable filename is treated as still-changing, not
// as settled.
function isSettledSessionFile(filename) {
  const m = filename.match(/^results_(\d{4})(\d{2})(\d{2})_/);
  if (!m) return false;
  const fileDayUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (Date.now() - fileDayUtc) > 2 * 24 * 60 * 60 * 1000;
}
