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
              // prefix of "EVO Nürburgring – TOURING #2"'s title, so a
              // loose substring match would let the shorter keyword
              // accidentally match the wrong (², nurburgringtour) server.
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

    const res = await fetch(apiUrl, { headers });
    const data = await res.text();

    return new Response(data, {
      status: res.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
