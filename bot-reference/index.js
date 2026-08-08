require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Partials,
} = require('discord.js');
const puppeteer = require('puppeteer');

const LIVE_TIMING_URL = 'https://ca.assettohosting.com:10102/live-timing';
// Per-server welcome channel config. Add a new guildId -> channelId entry
// here whenever the bot joins another server that wants welcome messages.
const WELCOME_CHANNELS_BY_GUILD = {
  '906573991492349962': process.env.WELCOME_CHANNEL_ID, // GT3FORC3
  '1534614323534499891': process.env.FORC3MOD_WELCOME_CHANNEL_ID, // FORC3MOD
};
// Per-guild invite channel config, same pattern as welcome channels above.
const INVITE_CHANNELS_BY_GUILD = {
  '906573991492349962': '906573991492349966', // GT3FORC3
  '1534614323534499891': '1534649367573827876', // FORC3MOD
};
/*!DISCORD SERVERS NAME*/
const GAME_SERVERS = [
  {
    trackName: 'EVO Nordschleife – HOT LAP',
    loginUrl: 'https://ca.assettohosting.com:10647/login',
    controlUrl: 'https://ca.assettohosting.com:10647/server-control',
    username: process.env.SERVER_CONTROL_USERNAME,
    password: process.env.SERVER_CONTROL_PASSWORD,
    imageUrl:
      'https://raw.githubusercontent.com/LachanceGL/gt3forc3-website/refs/heads/main/evo_status_track_Nordschleife08.jpg',
    subtitle: 'GT3FORC3.COM // Nürburgring Nordschleife – Hotlap',
  },
  {
    trackName: 'EVO Spa Francorchamps – HOT LAP',
    loginUrl: 'https://de8.assettohosting.com:60350/login',
    controlUrl: 'https://de8.assettohosting.com:60350/server-control',
    username: process.env.SERVER_CONTROL_2_USERNAME,
    password: process.env.SERVER_CONTROL_2_PASSWORD,
    imageUrl:
      'https://raw.githubusercontent.com/LachanceGL/gt3forc3-website/refs/heads/main/evo_status_track_Spa05.jpg',
    subtitle: 'GT3FORC3.COM // Spa Francorchamps – Hotlap',
  },
  {
    trackName: 'EVO Red Bull Ring – Race',
    loginUrl: 'https://fr.assettohosting.com:60795/login',
    controlUrl: 'https://fr.assettohosting.com:60795/server-control',
    username: process.env.SERVER_CONTROL_3_USERNAME,
    password: process.env.SERVER_CONTROL_3_PASSWORD,
    imageUrl:
      'https://raw.githubusercontent.com/LachanceGL/gt3forc3-website/refs/heads/main/evo_status_track_RedBullRing08.jpg',
    subtitle: 'GT3FORC3.COM // Red Bull Ring – RACE / 5 Laps / Q6mins',
    enabled: false, // temporarily offline - flip back to true when it's back up
  },
];
const RECENT_JOIN_WINDOW_MS = 5 * 60 * 1000; // only show joins from the last 5 minutes
const SERVER_CONNECTION_INFO = process.env.SERVER_CONNECTION_INFO || null; // optional, e.g. "1.2.3.4:8102"
const SERVER_STATUS_IMAGE_URL = process.env.SERVER_STATUS_IMAGE_URL || null; // optional banner image URL

const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const STATUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // refresh every 5 minutes - adjust as needed

// The "intents" tell Discord what kind of events we want to receive.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages, // needed to receive DMs sent to the bot
    GatewayIntentBits.MessageContent, // needed to read message text
    GatewayIntentBits.GuildMembers, // needed to detect new members joining
  ],
  // DM channels/messages are "partial" objects until fetched - without this,
  // messageCreate may not fire reliably for DMs.
  partials: [Partials.Channel, Partials.Message],
});

const PREFIX = '!';

// Wraps message.edit() so a deleted/missing message (Discord error 10008)
// never crashes the whole bot - it just logs a warning and moves on.
async function safeEdit(message, content) {
  try {
    await message.edit(content);
  } catch (err) {
    if (err.code === 10008) {
      console.warn('Tried to edit a message that no longer exists - skipping.');
    } else {
      console.error('Error editing message:', err);
    }
  }
}

// Opens the live timing page in a headless browser, waits for the JS-rendered
// table to load, then reads the "Best Lap" column for every driver (sorted
// fastest to slowest) plus the current track name.
async function getLapTimes() {
  const browser = await puppeteer.launch({ headless: 'new' });

  try {
    const page = await browser.newPage();
    await page.goto(LIVE_TIMING_URL, { waitUntil: 'networkidle2', timeout: 20000 });

    // Give the page's own JS a little extra time to populate the table
    // after the network goes idle (websocket data can arrive slightly later).
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const result = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      let entries = [];

      // The "Stored Times" table holds the full, authoritative rankings.
      // The table ABOVE it is just the current live session, which can have
      // its own (incomplete) "Best Lap" column - we never want to rank off that.
      const storedHeading = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5')).find((h) =>
        /stored times/i.test(h.textContent)
      );

      for (const table of tables) {
        if (storedHeading) {
          const position = storedHeading.compareDocumentPosition(table);
          // eslint-disable-next-line no-bitwise
          const tableIsAfterHeading = Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
          if (!tableIsAfterHeading) continue; // skip the live table above Stored Times
        }

        const headerCells = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
        const headers = headerCells.map((th) => th.textContent.trim().toLowerCase());
        const bestLapIndex = headers.findIndex((h) => h.includes('best lap'));
        const nameIndex = headers.findIndex((h) => h.includes('name') || h.includes('driver'));
        const carIndex = headers.findIndex((h) => h.includes('car'));

        if (bestLapIndex === -1) continue; // not the table we're looking for

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const found = [];

        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (!cells.length) continue;

          const lapText = cells[bestLapIndex]?.textContent.trim();
          const rawName = nameIndex !== -1 ? cells[nameIndex]?.textContent.trim() : 'Unknown';
          const driverName = rawName.replace(/`/g, "'").replace(/[\u0000-\u001f]/g, '');
          const car = carIndex !== -1 ? cells[carIndex]?.textContent.trim() : '';

          // Expecting something like "1:23.456" - skip empty/placeholder cells
          if (lapText && /\d+:\d{2}\.\d{3}/.test(lapText)) {
            found.push({ driverName, lapText, car });
          }
        }

        if (found.length) {
          entries = found;
          break;
        }
      }

      // The page shows text like "Practice at Nordschleife - Tourist" near
      // the top - pull the track name out of that instead of guessing at
      // specific CSS classes, and never fall back to the page <title> (it
      // can contain unrelated text like a Discord invite link).
      let trackName = null;
      const bodyText = document.body.innerText || '';
      const match = bodyText.match(/(?:Practice|Qualifying|Race|Booking)\s+at\s+([^\n]+)/i);
      if (match) {
        trackName = match[1].trim();
      }

      // Currently connected drivers live in the table ABOVE the "Stored
      // Times" heading (that second table is historical best times, which
      // can include people who've since disconnected).
      let onlinePlayers = [];
      for (const table of tables) {
        if (storedHeading) {
          const position = table.compareDocumentPosition(storedHeading);
          // eslint-disable-next-line no-bitwise
          const tableIsBeforeHeading = Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
          if (!tableIsBeforeHeading) continue;
        }

        const headerCells = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
        const headers = headerCells.map((th) => th.textContent.trim().toLowerCase());
        const nameIndex = headers.findIndex((h) => h.includes('driver') || h.includes('name'));
        const carIndex = headers.findIndex((h) => h.includes('car'));

        if (nameIndex === -1) continue;

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const names = [];

        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (!cells.length) continue;

          const driverName = cells[nameIndex]?.textContent.trim();
          const car = carIndex !== -1 ? cells[carIndex]?.textContent.trim() : '';

          if (driverName) {
            names.push({ driverName, car });
          }
        }

        if (names.length) {
          onlinePlayers = names;
          break;
        }
      }

      return { entries, trackName, onlinePlayers };
    });

    if (!result.entries.length) {
      return { laps: [], trackName: result.trackName, onlinePlayers: result.onlinePlayers };
    }

    // Convert "1:23.456" style times to milliseconds so we can compare them
    const toMs = (t) => {
      const match = t.match(/(\d+):(\d{2})\.(\d{3})/);
      if (!match) return Infinity;
      const [, min, sec, ms] = match;
      return Number(min) * 60000 + Number(sec) * 1000 + Number(ms);
    };

    const sorted = [...result.entries].sort((a, b) => toMs(a.lapText) - toMs(b.lapText));

    // Some drivers have multiple stored times (different cars/sessions) -
    // keep only their fastest one so they don't take multiple leaderboard spots.
    const seen = new Set();
    const laps = [];
    for (const lap of sorted) {
      if (!seen.has(lap.driverName)) {
        seen.add(lap.driverName);
        laps.push(lap);
      }
    }

    return { laps, trackName: result.trackName, onlinePlayers: result.onlinePlayers };
  } finally {
    await browser.close();
  }
}

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  scheduleNextStatusUpdate();
});


// Separate from GAME_SERVERS: these two channels are where ANOTHER bot
// already posts its own "X Player(s) Online" status for the original
// Assetto Corsa (AC1) servers. Instead of scraping those servers ourselves,
// we just read that other bot's existing messages and sum the counts, only
// to update the "Assetto Corsa" category name - nothing else is posted.
const AC1_CATEGORY_ID = '1454686612460929230';
const AC1_STATUS_CHANNEL_ID = '1059920486789820506'; // both AC1 servers now post their status here
let lastAC1CategoryPlayerCount = null;

// Reads recent messages in the channel and sums "X Player(s) Online" across
// EVERY distinct server status message found (since both Nordschleife and
// Spa now post in this same channel) - dedupes by embed title so an older
// leftover message for the same server isn't counted twice.
async function getAC1TotalPlayerCount() {
  try {
    const channel = await client.channels.fetch(AC1_STATUS_CHANNEL_ID);
    if (!channel) return 0;

    const messages = await channel.messages.fetch({ limit: 10 });
    let total = 0;
    const seenTitles = new Set();

    for (const msg of messages.values()) {
      const title = msg.embeds[0]?.title || msg.content.slice(0, 50);
      if (seenTitles.has(title)) continue;

      const embedText = msg.embeds.map((e) => JSON.stringify(e)).join(' ');
      const combined = `${msg.content} ${embedText}`;
      const match = combined.match(/(\d+)\s*Players?\s*Online/i);
      if (match) {
        total += Number(match[1]);
        seenTitles.add(title);
      }
    }

    return total;
  } catch (err) {
    console.error(`Error reading AC1 player counts from channel ${AC1_STATUS_CHANNEL_ID}:`, err);
    return 0;
  }
}

async function updateAC1CategoryPlayerCount() {
  try {
    const totalPlayers = await getAC1TotalPlayerCount();

    if (totalPlayers === lastAC1CategoryPlayerCount) return; // no change, skip the rename entirely

    const category = await client.channels.fetch(AC1_CATEGORY_ID);
    if (!category) return;

    // Strip any old "(N)" or "( 🟢 N )" suffix, however many got stacked on
    const baseName = category.name.replace(/(\s*\([^)]*\)\s*)+$/, '').trim();
    const newName = totalPlayers > 0 ? `${baseName}  ( 🟢 ${totalPlayers} )` : baseName;

    if (category.name !== newName) {
      await category.setName(newName);
    }
    lastAC1CategoryPlayerCount = totalPlayers;
  } catch (err) {
    console.error('Error updating AC1 category name:', err);
  }
}


// Runs a refresh, then schedules the next one only after this one finishes -
// prevents overlapping refreshes from stacking up if one runs slow.
async function scheduleNextStatusUpdate() {
  await updateStatusMessage();
  await updateAC1CategoryPlayerCount();
  setTimeout(scheduleNextStatusUpdate, STATUS_REFRESH_INTERVAL_MS);
}

// Remembers the last successful reading per server (by track name), so a
// refresh that can't find a fresh "Server updated" line just keeps showing
// the previous state instead of erroring or guessing.
const lastKnownGood = {};

// Tracks unique players seen connecting "today" per server, resetting at
// midnight. Since the console only keeps limited scrollback, this only
// counts joins that happen while the bot is running and refreshing often
// enough to catch them - not a perfect historical total.
const dailyJoinStats = {}; // trackName -> { date: 'YYYY-MM-DD', ids: Set }

function getTodayDateString() {
  // 'America/New_York' automatically handles EST/EDT (daylight saving)
  // for us, so the "day" always rolls over at midnight Eastern time.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // 'YYYY-MM-DD'
}

// Logs into a server-control panel, waits for the live console log to
// populate, and reads the most recent "Server updated: X players" line.
// `server` is one of the objects from GAME_SERVERS.
async function getServerPlayerCount(server) {
  if (!server.username || !server.password) {
    return {
      ok: false,
      trackName: server.trackName,
      reason: `Login credentials are not set in .env for ${server.trackName}`,
    };
  }

  const browser = await puppeteer.launch({ headless: 'new' });

  try {
    const page = await browser.newPage();
    await page.goto(server.loginUrl, { waitUntil: 'networkidle2', timeout: 20000 });

    // The exact field names can vary, so try a handful of likely selectors
    // for the username field. The password field type is reliable, though.
    const usernameSelector = await page.evaluate(() => {
      const candidates = [
        'input[name="username"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[type="text"]',
      ];
      return candidates.find((sel) => document.querySelector(sel)) || null;
    });

    const passwordSelector = 'input[type="password"]';
    const hasPasswordField = await page.$(passwordSelector);

    if (!usernameSelector || !hasPasswordField) {
      return { ok: false, trackName: server.trackName, reason: 'Could not find the login form fields on the login page.' };
    }

    await page.type(usernameSelector, server.username, { delay: 20 });
    await page.type(passwordSelector, server.password, { delay: 20 });

    await Promise.all([
      page.keyboard.press('Enter'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    ]);

    // Go directly to the server-control page in case login didn't redirect us there
    await page.goto(server.controlUrl, { waitUntil: 'networkidle2', timeout: 20000 });

    // Give the live console a moment to stream in some log lines
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const result = await page.evaluate((recentJoinWindowMs) => {
      const consoleEl = document.querySelector('#server-console') || document.querySelector('pre');
      const text = consoleEl?.textContent || '';
      const lines = text.split('\n');

      // FIRST PASS: find the log's own latest timestamp (used as "now" for
      // freshness comparisons, since the console's clock may differ from
      // ours) and the most recent "Server updated" count with its timestamp.
      let latestPlayerCount = null;
      let latestPlayerCountTs = null;
      let logNow = Date.now();
      const allTimestamps = [];

      for (const line of lines) {
        const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
        if (!tsMatch) continue;

        const ts = new Date(tsMatch[1].replace(' ', 'T')).getTime();
        if (Number.isNaN(ts)) continue;
        allTimestamps.push(ts);

        const countMatch = line.match(/Server updated:\s*(\d+)\s*players/i);
        if (countMatch) {
          latestPlayerCount = Number(countMatch[1]);
          latestPlayerCountTs = ts;
        }
      }

      if (allTimestamps.length) logNow = Math.max(...allTimestamps);

      // If the last "Server updated" line is much older than the rest of the
      // visible log, it's stale (probably a leftover from an old event) -
      // treat it as "no fresh reading" so the caller falls back to the cache.
      const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
      let playerCount = latestPlayerCount;
      if (playerCount !== null && logNow - latestPlayerCountTs > STALE_THRESHOLD_MS) {
        playerCount = null;
      }

      // SECOND PASS: now that we know logNow, actually apply the cutoff -
      // anything older than the recent-join window is dropped here, so a
      // stale connect from hours ago can never show up as "recently joined".
      const cutoff = logNow - recentJoinWindowMs;
      const allConnectIds = [];
      const lastSeenById = new Map(); // id -> name, re-inserted on each connect to track recency

      for (const line of lines) {
        const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
        if (!tsMatch) continue;

        const ts = new Date(tsMatch[1].replace(' ', 'T')).getTime();
        if (Number.isNaN(ts)) continue;

        const connectMatch = line.match(/connecting gamecar \S+ \(([^|]+)\|\s*(\d+)\)/i);
        if (connectMatch) {
          const id = connectMatch[2];
          // Strip backticks/control characters so a weird in-game name can't
          // break out of the code block or ansi formatting we wrap it in.
          const name = connectMatch[1].trim().replace(/`/g, "'").replace(/[\u0000-\u001f]/g, '');
          allConnectIds.push(id); // ALL connects, for the daily-joins counter regardless of age

          if (ts >= cutoff) {
            lastSeenById.delete(id);
            lastSeenById.set(id, name);
          }
        }
      }

      const recentlyJoined = [...lastSeenById.values()].slice(-5).reverse();

      return { playerCount, recentlyJoined, allConnectIds };
    }, RECENT_JOIN_WINDOW_MS);

    // Update today's unique-joins tracker for this server, resetting if the
    // date has rolled over since the last check.
    const today = getTodayDateString();
    if (!dailyJoinStats[server.trackName] || dailyJoinStats[server.trackName].date !== today) {
      dailyJoinStats[server.trackName] = { date: today, ids: new Set() };
    }
    for (const id of result.allConnectIds) {
      dailyJoinStats[server.trackName].ids.add(id);
    }
    const joinedToday = dailyJoinStats[server.trackName].ids.size;

    if (result.playerCount === null) {
      // No fresh "Server updated" line this refresh - keep the last known
      // PLAYER COUNT, but "Recently Joined" always uses the freshly
      // recomputed value from this exact check (it has its own cutoff
      // already applied) so it can never stay stuck on a stale cached name.
      if (lastKnownGood[server.trackName]) {
        return { ...lastKnownGood[server.trackName], recentlyJoined: result.recentlyJoined, joinedToday };
      }

      // No cached reading yet either (e.g. bot just started) - default to a
      // normal-looking empty state rather than an error box.
      return {
        ok: true,
        playerCount: 0,
        recentlyJoined: result.recentlyJoined,
        trackName: server.trackName,
        imageUrl: server.imageUrl,
        subtitle: server.subtitle,
        joinedToday,
      };
    }

    const fresh = {
      ok: true,
      playerCount: result.playerCount,
      recentlyJoined: result.recentlyJoined,
      trackName: server.trackName,
      imageUrl: server.imageUrl,
      subtitle: server.subtitle,
      joinedToday,
    };
    lastKnownGood[server.trackName] = fresh;
    return fresh;
  } catch (err) {
    console.error(`Error checking ${server.trackName}:`, err.message);

    // A single timeout/failure shouldn't kill the whole refresh cycle for
    // every server - fall back to the last known good reading if we have
    // one, otherwise report this specific server as unavailable.
    if (lastKnownGood[server.trackName]) {
      return lastKnownGood[server.trackName];
    }

    return {
      ok: false,
      trackName: server.trackName,
      imageUrl: server.imageUrl,
      reason: `Timed out or failed to load the server-control page (${err.message}).`,
    };
  } finally {
    await browser.close();
  }
}

// Keeps one message PER SERVER in the status channel, keyed by track name,
// updated on a timer, instead of posting a new message every refresh.
let statusMessages = {};

// Builds one embed per server (instead of one shared embed), each with its
// own title, player count, and players list - similar to how other
// server-status bots split things out per server.
function buildStatusEmbeds(results, guildIconURL) {
  return results.map((result) => {
    const embed = new EmbedBuilder().setTimestamp().setFooter({ text: 'Last Refresh' });

    if (result.imageUrl) {
      embed.setImage(result.imageUrl);
    } else if (guildIconURL) {
      embed.setThumbnail(guildIconURL);
    }

    if (!result.ok) {
      embed
        .setTitle(result.trackName)
        .setColor(0xe74c3c)
        .setDescription(`🔴 ⚠️ ${result.reason}`);
      return embed;
    }

    const recentlyJoinedList = result.recentlyJoined?.length ? result.recentlyJoined : ['---'];

    const onlineEmoji = result.playerCount > 0 ? '🟢 ' : '';
    const playerLabel = `${onlineEmoji}${result.playerCount} Player${result.playerCount === 1 ? '' : 's'} Online`;
    const colorCode = result.playerCount > 0 ? '32' : '31'; // green if players online, red if empty
    const pinkPlayerLabel = `\u001b[1;${colorCode}m${playerLabel}\u001b[0m`;
    const playerBlock = `\`\`\`ansi\n${pinkPlayerLabel}\n\`\`\``;

    // Small subtext (outside the code block) for the Recently Joined section
    const recentlyJoinedSection = [
      '-# __Recently Joined__ :',
      ...recentlyJoinedList.map((name) => `-# • ${name}`),
    ].join('\n');

    const joinedTodayLine = `-# __Joined Today__ : **${result.joinedToday ?? 0}**`;
    embed
      .setTitle(`🏁 ${result.trackName}`)
      .setDescription(`${playerBlock}\n${joinedTodayLine}\n${recentlyJoinedSection}`);

    if (SERVER_CONNECTION_INFO) {
      embed.addFields({ name: 'Connection Info', value: SERVER_CONNECTION_INFO, inline: true });
    }

    if (SERVER_STATUS_IMAGE_URL) {
      embed.setImage(SERVER_STATUS_IMAGE_URL);
    }

    return embed;
  });
}

function buildRefreshRow(serverIndex, trackName, hasPlayers) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`refresh_server_status_${serverIndex}`)
      .setLabel('Refresh Server')
      .setStyle(ButtonStyle.Success)
  );
}

// Renames the category to show the highest current player count across all
// servers, e.g. "ASSETTO CORSA EVO (6)". Only renames when the number
// actually changes, since Discord allows just 2 renames per 10 minutes.
let lastCategoryPlayerCount = null;

async function updateCategoryPlayerCount(results, channel) {
  const category = channel.parent;
  if (!category) return;

  const totalPlayers = results.reduce((sum, r) => sum + (r.ok ? r.playerCount : 0), 0);
  if (totalPlayers === lastCategoryPlayerCount) return; // no change, skip the rename entirely

  try {
    // Strip any old "(N)" or "( N )" suffix, however many got stacked on
    const baseName = category.name.replace(/(\s*\([^)]*\)\s*)+$/, '').trim();
    const newName = totalPlayers > 0 ? `${baseName}  ( 🟢 ${totalPlayers} )` : baseName;

    if (category.name !== newName) {
      await category.setName(newName);
      lastCategoryPlayerCount = totalPlayers;
    }
  } catch (err) {
    console.error('Error updating category name:', err);
  }
}

async function updateStatusMessage() {
  if (!STATUS_CHANNEL_ID) {
    console.warn('STATUS_CHANNEL_ID is not set in .env - skipping auto status updates.');
    return;
  }

  try {
    const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
    if (!channel) {
      console.warn('Could not find the status channel - check STATUS_CHANNEL_ID in .env.');
      return;
    }

    // Skip disabled servers entirely (temporarily offline, but keep the
    // config around for when they come back), except for a one-time update
    // to mark their existing message as paused.
    const activeServers = GAME_SERVERS.filter((s) => s.enabled !== false);
    const disabledServers = GAME_SERVERS.filter((s) => s.enabled === false);

    const results = await Promise.all(activeServers.map((server) => getServerPlayerCount(server)));
    await updateCategoryPlayerCount(results, channel);
    const guildIconURL = channel.guild ? channel.guild.iconURL() : null;
    const embeds = buildStatusEmbeds(results, guildIconURL);

    if (Object.keys(statusMessages).length === 0) {
      // Look for status messages left over from a previous run, matched by
      // embed title, so restarting the bot doesn't spam new messages.
      const recentMessages = await channel.messages.fetch({ limit: 20 });
      for (const m of recentMessages.values()) {
        const title = m.embeds[0]?.title;
        if (m.author.id === client.user.id && title && !statusMessages[title]) {
          statusMessages[title] = m;
        }
      }
    }

    // Disabled servers should show nothing at all - if a message still
    // exists from before, delete it outright rather than replacing it.
    for (const server of disabledServers) {
      const existing = statusMessages[`🏁 ${server.trackName}`];
      if (existing) {
        try {
          await existing.delete();
        } catch (err) {
          if (err.code !== 10008) console.error('Error deleting disabled server message:', err);
        }
        delete statusMessages[`🏁 ${server.trackName}`]; // stop touching it going forward
      }
    }

    for (let i = 0; i < results.length; i++) {
      const embedTitle = embeds[i].data.title;
      const existing = statusMessages[embedTitle];

      if (existing) {
        try {
          await existing.edit({ content: null, embeds: [embeds[i]], components: [] });
        } catch (err) {
          if (err.code === 10008) {
            // That message was deleted (manually, or by Discord) - forget the
            // stale reference and post a fresh one instead of erroring forever.
            console.warn(`Status message for "${embedTitle}" no longer exists - posting a new one.`);
            delete statusMessages[embedTitle];
            statusMessages[embedTitle] = await channel.send({ embeds: [embeds[i]] });
          } else {
            throw err;
          }
        }
      } else {
        statusMessages[embedTitle] = await channel.send({ embeds: [embeds[i]] });
      }
    }
  } catch (err) {
    console.error('Error updating status message:', err);
  }
}

// Builds the welcome text for a given member. Customize the wording here -
// both a real join and !testwelcome use this exact same function.
function buildWelcomeMessage(member) {
  return `🏁 ${member}, Welcome to **${member.guild.name}** Discord!`;
}

async function sendWelcomeMessage(member) {
  const channelId = WELCOME_CHANNELS_BY_GUILD[member.guild.id];

  if (!channelId) {
    console.warn(`No welcome channel configured for guild "${member.guild.name}" (${member.guild.id}) - skipping.`);
    return { ok: false, reason: `No welcome channel configured for this server (${member.guild.name}).` };
  }

  const channel = await member.guild.channels.fetch(channelId);
  if (!channel) {
    console.warn(`Could not find the welcome channel for guild "${member.guild.name}" - check its ID.`);
    return { ok: false, reason: 'Could not find the configured welcome channel for this server.' };
  }

  await channel.send(buildWelcomeMessage(member));
  return { ok: true, channel };
}

// Guards against sending duplicate welcome messages for the same person in
// a short window - protects against duplicate bot processes or duplicate
// event listeners accidentally firing twice for the same join.
const recentlyWelcomed = new Map(); // userId -> timestamp
const WELCOME_DEDUPE_WINDOW_MS = 10 * 1000; // 10 seconds

// Fires whenever someone new joins the server
client.on('guildMemberAdd', async (member) => {
  const lastWelcomed = recentlyWelcomed.get(member.id);
  if (lastWelcomed && Date.now() - lastWelcomed < WELCOME_DEDUPE_WINDOW_MS) {
    console.warn(`Skipping duplicate welcome for ${member.user.tag} - already welcomed moments ago.`);
    return;
  }
  recentlyWelcomed.set(member.id, Date.now());

  try {
    await sendWelcomeMessage(member);
  } catch (err) {
    console.error('Error sending welcome message:', err);
  }
});

// Fires whenever someone leaves (or is removed from) the server
client.on('guildMemberRemove', async (member) => {
  const LEAVE_CHANNEL_ID = '1522087711358586970';

  try {
    const channel = await client.channels.fetch(LEAVE_CHANNEL_ID);
    if (!channel) {
      console.warn('Could not find the leave-notification channel - check LEAVE_CHANNEL_ID.');
      return;
    }

    const displayName = member.user.globalName || member.user.username;
    const nameLine =
      displayName !== member.user.username ? `${displayName} (@${member.user.username})` : member.user.username;

    // member.joinedAt is only available if this member object was cached
    // (e.g. was in the server while the bot was already running). For
    // members who joined before the bot's current session and left without
    // ever being cached, this can be null - handled below.
    const joinedLine = member.joinedAt
      ? `\n📅 Joined: <t:${Math.floor(member.joinedAt.getTime() / 1000)}:F> (<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>)`
      : '\n📅 Joined: *unknown (not cached)*';

    await channel.send(`👋 **${nameLine}** has left the server.${joinedLine}`);
  } catch (err) {
    console.error('Error sending leave notification:', err);
  }
});

client.on('messageCreate', async (message) => {
  // Ignore messages from bots (including itself) to avoid loops
  if (message.author.bot) return;

  const ADMIN_USER_ID = '148119339847909376';

  // If this is a DM to the bot (not a message in a server), forward its
  // content to a fixed admin user instead of processing it as a command -
  // UNLESS it's the admin themselves sending a command (e.g. !reply),
  // in which case let it fall through to normal command handling below.
  if (!message.guild) {
    const isAdminCommand = message.author.id === ADMIN_USER_ID && message.content.startsWith(PREFIX);

    if (!isAdminCommand) {
      try {
        const admin = await client.users.fetch(ADMIN_USER_ID);
        const attachmentNote = message.attachments.size
          ? `\n📎 ${message.attachments.size} attachment(s): ${[...message.attachments.values()].map((a) => a.url).join(' ')}`
          : '';
        const displayName = message.author.globalName || message.author.username;
        const nameLine =
          displayName !== message.author.username
            ? `${displayName} (@${message.author.username})`
            : message.author.username;

        await admin.send(
          `📩 **DM from ${nameLine}** (\`${message.author.id}\`):\n${message.content || '*[no text content]*'}${attachmentNote}`
        );
      } catch (err) {
        console.error('Error forwarding DM to admin:', err);
      }
      return; // don't try to process this as a guild command
    }
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

// !reply <userID> <message>  ->  admin-only, DMs a specific user on the bot's behalf
  if (command === 'reply') {
    if (message.author.id !== ADMIN_USER_ID) {
      return message.reply('⛔ Only the admin can use this command.');
    }

    const targetUserId = args.shift();
    const replyText = args.join(' ');

    if (!targetUserId || !replyText) {
      return message.reply('Usage: `!reply <userID> <message>`');
    }

    try {
      const targetUser = await client.users.fetch(targetUserId);
      await targetUser.send(replyText);
      await message.reply(`✅ Sent to ${targetUser.tag}.`);
    } catch (err) {
      console.error('Error sending reply DM:', err);
      await message.reply('❌ Could not send that DM — check the user ID is correct and they allow DMs from server members.');
    }
  }
  
  // !invite -> generates an invite link attributed to the bot itself,
  // pointing to the invite channel configured for the guild it was run in
  if (command === 'invite') {
    if (!message.guild) {
      return message.reply('⛔ `!invite` only works inside a server, not in DMs.');
    }

    const inviteChannelId = INVITE_CHANNELS_BY_GUILD[message.guild.id];
    if (!inviteChannelId) {
      return message.reply(`⚠️ No invite channel configured for this server (${message.guild.name}).`);
    }

    try {
      const inviteChannel = await client.channels.fetch(inviteChannelId);
      const invite = await inviteChannel.createInvite({
        maxAge: 0, // never expires
        maxUses: 0, // unlimited uses
        unique: false, // reuse an existing bot-created invite for this channel if one exists
      });

      await message.channel.send(`https://discord.gg/${invite.code}`);
    } catch (err) {
      console.error('Error creating invite:', err);
      await message.reply('❌ Could not create an invite — check that I have the "Create Invite" permission in the target channel.');
    }
  }

  // !say <message>  ->  bot deletes your message and posts it as itself
  if (command === 'say') {
    const text = args.join(' ');

    if (!text) {
      return message.reply('Give me something to say! Example: `!say Hello world`');
    }

    try {
      await message.delete(); // requires "Manage Messages" permission
    } catch (err) {
      console.warn('Could not delete original message (missing permissions?)');
    }

    await message.channel.send(text);
  }

  // !serverstatus -> logs into each server-control panel and reports current player counts
  if (command === 'serverstatus') {
    const loadingMsg = await message.channel.send('⏳ Checking server status...');

    try {
      const activeGameServers = GAME_SERVERS.filter((s) => s.enabled !== false);
      const results = await Promise.all(activeGameServers.map((server) => getServerPlayerCount(server)));
      const guildIconURL = message.guild ? message.guild.iconURL() : null;
      const embeds = buildStatusEmbeds(results, guildIconURL);

      await safeEdit(loadingMsg, { content: null, embeds: [embeds[0]] });
      for (let i = 1; i < embeds.length; i++) {
        await message.channel.send({ embeds: [embeds[i]] });
      }
    } catch (err) {
      console.error('Error fetching server status:', err);
      await safeEdit(loadingMsg, '❌ Something went wrong checking the server status.');
    }
  }

  // !edit <new text> -> reply to a message the bot sent to edit its content
  if (command === 'edit') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('⛔ Only admins can use this command.');
    }

    const newText = args.join(' ');

    if (!newText) {
      return message.reply('Reply to a message I sent, and type `!edit New text here` to update it.');
    }

    if (!message.reference) {
      return message.reply(
        "Reply to the message you want to edit first (right-click / long-press it → Reply), then type `!edit New text`."
      );
    }

    try {
      const targetMessage = await message.channel.messages.fetch(message.reference.messageId);

      if (targetMessage.author.id !== client.user.id) {
        return message.reply('I can only edit messages that I sent myself.');
      }

      await targetMessage.edit(newText);

      try {
        await message.delete(); // clean up your !edit command message
      } catch (err) {
        console.warn('Could not delete the !edit command message (missing permissions?)');
      }
    } catch (err) {
      console.error('Error editing message:', err);
      await message.reply('❌ Something went wrong editing that message.');
    }
  }

  // !testwelcome -> fires the welcome message using yourself, to preview it
  if (command === 'testwelcome') {
    try {
      const result = await sendWelcomeMessage(message.member);

      if (!result.ok) {
        await message.channel.send(`⚠️ ${result.reason}`);
        return;
      }

      await message.channel.send(`✅ Test welcome sent to ${result.channel}.`);
    } catch (err) {
      console.error('Error sending test welcome:', err);
      await message.channel.send('❌ Something went wrong sending the test welcome.');
    }
  }

  // !bestlap or !bl -> fetches the current Best Lap from the live timing page
  if (command === 'bestlap' || command === 'bl') {
    const loadingMsg = await message.channel.send('⏳ Checking live timing...');

    try {
      const { laps, trackName } = await getLapTimes();

      if (!laps.length) {
        await safeEdit(loadingMsg, '⚠️ Could not find a Best Lap on the live timing page right now (server may be offline or between sessions).');
        return;
      }

      const fastest = laps[0];
      const header = trackName ? `🏁 **AC1 Best Lap — ${trackName}**` : '🏁 **AC1 Best Lap**';
      const pinkLine = `\u001b[1;35m${fastest.lapText} — ${fastest.driverName}\u001b[0m`;
      await safeEdit(loadingMsg, `${header}\n\`\`\`ansi\n${pinkLine}\n\`\`\``);
    } catch (err) {
      console.error('Error fetching live timing:', err);
      await safeEdit(loadingMsg, '❌ Something went wrong fetching the live timing page.');
    }
  }

  // !top5 -> fetches the 5 fastest laps from the live timing page
  if (command === 'top5') {
    const loadingMsg = await message.channel.send('⏳ Checking live timing...');

    try {
      const { laps, trackName } = await getLapTimes();

      if (!laps.length) {
        await safeEdit(loadingMsg, '⚠️ Could not find any lap times on the live timing page right now (server may be offline or between sessions).');
        return;
      }

      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      const top5 = laps.slice(0, 5);

      // #1 gets a pink highlight, the rest are bold white — all inside one box
      const lines = top5.map((lap, i) => {
        const color = i === 0 ? '1;35' : '1;37';
        const carSuffix = lap.car ? ` (${lap.car})` : '';
        return `\u001b[${color}m${medals[i]} ${lap.lapText} — ${lap.driverName}${carSuffix}\u001b[0m`;
      });

      const header = trackName
        ? `🏁 **AC1 Top ${top5.length} Best Lap — ${trackName}**`
        : `🏁 **AC1 Top ${top5.length} Best Lap**`;

      await safeEdit(loadingMsg, `${header}\n\`\`\`ansi\n${lines.join('\n')}\n\`\`\``);
    } catch (err) {
      console.error('Error fetching live timing:', err);
      await safeEdit(loadingMsg, '❌ Something went wrong fetching the live timing page.');
    }
  }

  // !top10 -> fetches the 10 fastest laps from the live timing page
  if (command === 'top10') {
    const loadingMsg = await message.channel.send('⏳ Checking live timing...');

    try {
      const { laps, trackName } = await getLapTimes();

      if (!laps.length) {
        await safeEdit(loadingMsg, '⚠️ Could not find any lap times on the live timing page right now (server may be offline or between sessions).');
        return;
      }

      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
      const top10 = laps.slice(0, 10);

      // #1 gets a pink highlight, the rest are bold white — all inside one box
      const lines = top10.map((lap, i) => {
        const color = i === 0 ? '1;35' : '1;37';
        const carSuffix = lap.car ? ` (${lap.car})` : '';
        return `\u001b[${color}m${medals[i]} ${lap.lapText} — ${lap.driverName}${carSuffix}\u001b[0m`;
      });

      const header = trackName
        ? `🏁 **AC1 Top ${top10.length} Best Lap — ${trackName}**`
        : `🏁 **AC1 Top ${top10.length} Best Lap**`;

      await safeEdit(loadingMsg, `${header}\n\`\`\`ansi\n${lines.join('\n')}\n\`\`\``);
    } catch (err) {
      console.error('Error fetching live timing:', err);
      await safeEdit(loadingMsg, '❌ Something went wrong fetching the live timing page.');
    }
  }

  // !online -> lists everyone currently connected to the server
  if (command === 'online') {
    const loadingMsg = await message.channel.send('⏳ Checking online drivers...');

    try {
      const { onlinePlayers, trackName } = await getLapTimes();

      if (!onlinePlayers.length) {
        await safeEdit(loadingMsg, '👻 No one appears to be connected right now.');
        return;
      }

      const header = trackName
        ? `🟢 **AC1 Online (${onlinePlayers.length}) — ${trackName}**`
        : `🟢 **AC1 Online (${onlinePlayers.length})**`;

      const lines = onlinePlayers.map((p) => (p.car ? `• ${p.driverName} — ${p.car}` : `• ${p.driverName}`));

      await safeEdit(loadingMsg, `${header}\n${lines.join('\n')}`);
    } catch (err) {
      console.error('Error fetching live timing:', err);
      await safeEdit(loadingMsg, '❌ Something went wrong fetching the live timing page.');
    }
  }
});

// Handles clicks on a "Refresh" button - re-checks just that one server
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton() || !interaction.customId.startsWith('refresh_server_status_')) return;

  const serverIndex = Number(interaction.customId.replace('refresh_server_status_', ''));
  const server = GAME_SERVERS[serverIndex];
  if (!server) return;

  try {
    await interaction.deferUpdate();
  } catch (err) {
    console.error('deferUpdate failed:', err);
    return;
  }

  // Immediate feedback: disable the button and show "Refreshing..." right
  // away, since the real check can take 15-30 seconds to complete.
  const refreshingRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`refresh_server_status_${serverIndex}`)
      .setLabel('Refreshing...')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  try {
    await interaction.editReply({ components: [refreshingRow] });
  } catch (err) {
    console.error('Error showing refreshing state:', err);
  }
  try {
    const result = await getServerPlayerCount(server);

    const allCachedResults = GAME_SERVERS.map(
      (s) => lastKnownGood[s.trackName] || { ok: true, playerCount: 0, trackName: s.trackName }
    );
    await updateCategoryPlayerCount(allCachedResults, interaction.channel);

    const guildIconURL = interaction.guild ? interaction.guild.iconURL() : null;
    const [embed] = buildStatusEmbeds([result], guildIconURL);

    await interaction.editReply({
      embeds: [embed],
      components: [buildRefreshRow(serverIndex, server.trackName, result.ok && result.playerCount > 0)],
    });
  } catch (err) {
    console.error('Error handling refresh button:', err);

    // Always restore the button to a clickable state, even if the check
    // above failed - otherwise it stays stuck disabled forever.
    try {
      await interaction.editReply({
        components: [buildRefreshRow(serverIndex, server.trackName, false)],
      });
    } catch (restoreErr) {
      console.error('Error restoring refresh button after failure:', restoreErr);
    }
  }
});

// Last-resort safety net: log unexpected errors instead of letting them
// crash the whole bot process (e.g. a Discord API error we didn't catch).
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

client.login(process.env.DISCORD_TOKEN);

// Ensure Ctrl+C shuts everything down immediately, instead of waiting
// on Discord/Chromium handles to close on their own.
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down...');
  await client.destroy();
  process.exit(0);
});