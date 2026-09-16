// @ts-nocheck
// Generated from Royal Rangers via scripts/build-render.mjs. Private ratings are runtime-only.
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/render/postgres.ts
import pg from "pg";
var tables = { push_settings: "id TEXT PRIMARY KEY,data TEXT NOT NULL", push_subscriptions: "endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL,player_id TEXT NOT NULL,data TEXT NOT NULL,updated_at BIGINT NOT NULL", push_deliveries: "id TEXT PRIMARY KEY,created_at BIGINT NOT NULL", tournaments: "id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0", seasons: "id TEXT PRIMARY KEY,data TEXT NOT NULL", members: "id TEXT PRIMARY KEY,name TEXT NOT NULL,player_id TEXT,created_at BIGINT NOT NULL", committee_seats: "name TEXT PRIMARY KEY,user_id TEXT UNIQUE", committee_sessions: "token TEXT PRIMARY KEY,user_id TEXT NOT NULL,committee_name TEXT,expires BIGINT NOT NULL", access_attempts: "id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at BIGINT NOT NULL", private_ratings: "id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0", audit_log: "id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,season TEXT,created_at BIGINT NOT NULL", credentials: "user_id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at BIGINT NOT NULL", member_sessions: "token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires BIGINT NOT NULL", approved_players: "id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,created_at BIGINT NOT NULL", player_registrations: "player_id TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,created_at BIGINT NOT NULL" };
var pool;
var ready;
function getPool() {
  return pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 3e4, connectionTimeoutMillis: 1e4, ssl: process.env.PGSSLMODE === "require" || process.env.PGSSL === "true" || /render\.com/i.test(process.env.DATABASE_URL || "") ? { rejectUnauthorized: false } : void 0 });
}
async function initialize() {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(82644193)");
    await c.query("CREATE SCHEMA IF NOT EXISTS royal_rangers");
    await c.query("SET LOCAL search_path TO royal_rangers");
    for (const [name, columns] of Object.entries(tables)) await c.query(`CREATE TABLE IF NOT EXISTS ${name} (${columns})`);
    await c.query("CREATE TABLE IF NOT EXISTS migration_state (id TEXT PRIMARY KEY, imported_at BIGINT NOT NULL)");
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function init() {
  if (!ready) ready = initialize().catch((e) => {
    ready = void 0;
    throw e;
  });
  await ready;
}
function postgresSql(sql) {
  let n = 0;
  const ignore = /^INSERT OR IGNORE /i.test(sql);
  let converted = sql.replace(/^INSERT OR IGNORE /i, "INSERT ").replace(/\?/g, () => `$${++n}`);
  if (ignore) converted += " ON CONFLICT DO NOTHING";
  return converted;
}
function normalize(rows) {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ["created_at", "registered_at", "expires", "reset_at"].includes(k) && typeof v === "string" ? Number(v) : v])));
}
async function transact(statements, requireImport = true) {
  await init();
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(82644193)");
    await c.query("SET LOCAL search_path TO royal_rangers");
    if (requireImport) {
      const imported = await c.query("SELECT id FROM migration_state WHERE id='initial'");
      if (!imported.rowCount) throw Error("Royal Rangers migration is in progress.");
    }
    const output = [];
    for (const s of statements) {
      const r = await c.query(postgresSql(s.sql), s.values);
      output.push({ results: normalize(r.rows), meta: { changes: r.command === "SELECT" ? 0 : r.rowCount ?? 0 }, success: true });
    }
    await c.query("COMMIT");
    return output;
  } catch (e) {
    await c.query("ROLLBACK");
    if (e.code === "23505") throw Error("UNIQUE constraint: player or username already exists");
    throw e;
  } finally {
    c.release();
  }
}
var Statement = class _Statement {
  constructor(sql, values = []) {
    this.sql = sql;
    this.values = values;
  }
  bind(...values) {
    return new _Statement(this.sql, values);
  }
  async all() {
    return (await transact([this]))[0];
  }
  async first() {
    return (await this.all()).results[0] ?? null;
  }
  async run() {
    return (await transact([this]))[0];
  }
};
function database() {
  return { prepare: (sql) => new Statement(sql), batch: async (statements) => await transact(statements) };
}
async function migrationStatus() {
  await init();
  const c = await getPool().connect();
  try {
    const r = await c.query("SELECT id FROM royal_rangers.migration_state WHERE id='initial'");
    return !!r.rowCount;
  } finally {
    c.release();
  }
}
async function importSnapshot(snapshot) {
  await init();
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(82644193)");
    await c.query("SET LOCAL search_path TO royal_rangers");
    if ((await c.query("SELECT id FROM migration_state WHERE id='initial'")).rowCount) throw Error("Already imported");
    for (const name of Object.keys(tables)) {
      if (!Array.isArray(snapshot[name])) throw Error("Missing table " + name);
      const allowed = new Set(tables[name].split(",").map((v) => v.trim().split(" ")[0]));
      for (const row of snapshot[name]) {
        const columns = Object.keys(row);
        if (columns.some((k) => !allowed.has(k))) throw Error("Invalid column");
        await c.query(`INSERT INTO ${name} (${columns.join(",")}) VALUES (${columns.map((_, i) => "$" + (i + 1)).join(",")})`, Object.values(row));
      }
    }
    await c.query("INSERT INTO migration_state VALUES ('initial',$1)", [Date.now()]);
    await c.query("COMMIT");
    return Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, v.length]));
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function resetAttendanceOnce(seasonId, marker) {
  await init();
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(82644193)");
    await c.query("SET LOCAL search_path TO royal_rangers");
    const done = await c.query("SELECT data FROM push_settings WHERE id=$1", [marker]);
    if (done.rowCount) {
      await c.query("COMMIT");
      return { applied: false, count: JSON.parse(done.rows[0].data).count };
    }
    const row = await c.query("SELECT data FROM seasons WHERE id=$1", [seasonId]);
    if (!row.rowCount) throw Error("Attendance season not found");
    const season = JSON.parse(row.rows[0].data);
    if (season.availabilityClosed || season.squadsPublishedAt || season.publishedAt || season.squadsPublished || season.published || season.matches.some((m) => m.started)) throw Error("Attendance reset requires an open season");
    const players = await c.query("SELECT id FROM approved_players");
    const ids = [.../* @__PURE__ */ new Set([...players.rows.map((p) => p.id), ...season.players.map((p) => p.id)])];
    const now = Date.now();
    const backup = { count: ids.length, seasonId, at: now, previous: season.availability || {} };
    season.availability = Object.fromEntries(ids.map((id) => [id, "unavailable"]));
    await c.query("UPDATE seasons SET data=$1 WHERE id=$2", [JSON.stringify(season), seasonId]);
    await c.query("UPDATE tournaments SET revision=revision+1 WHERE id=$1", ["royal-rangers"]);
    await c.query("INSERT INTO push_settings (id,data) VALUES ($1,$2)", [marker, JSON.stringify(backup)]);
    await c.query("INSERT INTO audit_log (id,actor,action,season,created_at) VALUES ($1,$2,$3,$4,$5)", [crypto.randomUUID(), "Alpha", "Set all players absent: attendance reminder rollout", seasonId, now]);
    await c.query("COMMIT");
    return { applied: true, count: ids.length };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

// lib/attendance.ts
var ATTENDANCE_REMINDER_MS = 60 * 60 * 1e3;
function attendanceOpen(season, now = Date.now()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return season.date >= today && !season.availabilityClosed && !season.squadsPublishedAt && !season.publishedAt && !season.squadsPublished && !season.published && !season.matches.some((m) => m.started);
}
function attendanceReminder(season, playerId, now = Date.now(), name) {
  if (!attendanceOpen(season, now) || season.availability?.[playerId] === "available") return null;
  const firstName = name?.trim().split(/\s+/)[0] || "Ranger";
  const date = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(/* @__PURE__ */ new Date(season.date + "T12:00:00+05:30"));
  return { type: "attendance", title: `Ready for Saturday, ${firstName}? \u{1F3CF}`, body: `The Rangers are getting set for ${date}. Joining us at the ground? Tap to make your match-day call.`, tag: `attendance-${season.id}-${playerId}`, url: `/?page=attendance&season=${encodeURIComponent(season.id)}` };
}

// lib/cricket.ts
var TEAMS = ["White", "Black", "Blue"];
var defaultPoints = { halfCentury: 15, century: 30, wicketHatTrick: 15, sixHatTrick: 15, run: 1, wicket: 10, catch: 10, runout: 10, stumping: 10, maiden: 15, economyExcellent: 6, economyGood: 4, economyFair: 2, economyExpensive: -2, economyMinOvers: 2 };
function saturday() {
  const d = new Date((/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  d.setDate(d.getDate() + (6 - d.getDay() + 7) % 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function wide(b) {
  return b.kind === "wide" || b.kind === "wicket" && b.extra === "wide";
}
function noBall(b) {
  return b.kind === "nb" || b.kind === "wicket" && b.extra === "nb";
}
function legal(b) {
  return !wide(b) && !noBall(b);
}
var MAX_BOWLER_BALLS = 12;
function bowlerBalls(m, id) {
  return m.innings.flat().filter((b) => b.bowler === id && legal(b)).length;
}
function total(b) {
  return b.runs + (wide(b) || noBall(b) ? 1 : 0);
}
function summary(e) {
  return { runs: e.reduce((n, b) => n + total(b), 0), wickets: e.filter((b) => b.kind === "wicket").length, balls: e.filter(legal).length };
}
function batting(m, i) {
  return i === 0 ? m.first : m.first === m.home ? m.away : m.home;
}
function inningsDone(s, m, i) {
  const x = summary(m.innings[i]);
  return x.balls >= m.overs * 6 || x.wickets >= Math.max(1, s.players.filter((p) => p.team === batting(m, i)).length - 1) || i === 1 && x.runs > summary(m.innings[0]).runs;
}
function phase(s, m) {
  return !m.started ? -1 : !inningsDone(s, m, 0) ? 0 : !inningsDone(s, m, 1) ? 1 : 2;
}
function nextPair(events) {
  const b = events.at(-1);
  if (!b) return { striker: "", partner: "", bowler: "", freeHit: false };
  let striker = b.striker, partner = b.partner;
  if (b.runs % 2) [striker, partner] = [partner, striker];
  if (b.kind === "wicket") {
    if (striker === b.out) striker = "";
    if (partner === b.out) partner = "";
  }
  const x = summary(events);
  if (legal(b) && x.balls % 6 === 0) [striker, partner] = [partner, striker];
  const freeHit = false;
  return { striker, partner, bowler: legal(b) && x.balls % 6 === 0 ? "" : b.bowler, freeHit };
}
function check(ok, msg) {
  if (!ok) throw new Error(msg);
}
function validateBall(s, m, b) {
  const i = phase(s, m);
  check(i === 0 || i === 1, "This innings is already complete.");
  check(i !== 1 || !m.pauseBetweenInnings || m.secondInningsStarted, "Start the next innings before scoring.");
  check(["run", "wide", "nb", "bye", "legbye", "wicket"].includes(b.kind), "Invalid delivery.");
  check(Number.isInteger(b.runs) && b.runs >= 0 && b.runs <= (b.overthrow ? 20 : 6), "Use Overthrow for totals above six (maximum 20).");
  check(b.overthrow === void 0 || typeof b.overthrow === "boolean", "Invalid overthrow flag.");
  const events = m.innings[i], pair = nextPair(events), available = s.players.filter((p) => p.team === batting(m, i) && !events.some((e) => e.out === p.id));
  check(b.striker !== b.partner && available.some((p) => p.id === b.striker) && available.some((p) => p.id === b.partner), "Choose two different available batters.");
  check(!pair.striker || pair.striker === b.striker, "The striker has changed.");
  check(!pair.partner || pair.partner === b.partner, "The non-striker has changed.");
  check(s.players.some((p) => p.id === b.bowler && p.team === batting(m, 1 - i)), "Choose a bowler from the fielding team.");
  check(bowlerBalls(m, b.bowler) < MAX_BOWLER_BALLS, "This bowler has completed the maximum 2 overs for this match. Choose another bowler.");
  if (pair.bowler) check(pair.bowler === b.bowler, "Keep the same bowler until the over ends.");
  else if (events.length) check(events.at(-1)?.bowler !== b.bowler, "Choose a different bowler for the new over.");
  if (b.kind === "wicket") {
    check(["Bowled", "Caught", "Stumped", "Run out", "Hit wicket"].includes(b.dismissal || ""), "Choose a dismissal.");
    check(["legal", "wide", "nb"].includes(b.extra || "legal"), "Invalid extra.");
    check(b.out === b.striker || b.out === b.partner, "Choose the dismissed batter.");
    if (b.dismissal !== "Run out") {
      check(b.out === b.striker, "Only the striker can be dismissed this way.");
      check(b.runs === 0, "Use zero completed runs for this dismissal.");
      check(!noBall(b), "Only run-outs are supported on the no-ball itself.");
      if (wide(b)) check(b.dismissal === "Stumped" || b.dismissal === "Hit wicket", "That dismissal is not valid on a wide.");
    }
    if (["Caught", "Run out", "Stumped"].includes(b.dismissal)) check(s.players.some((p) => p.id === b.fielder && p.team === batting(m, 1 - i)), "Choose the fielder to award points.");
  } else check(!b.out && !b.dismissal && !b.fielder && !b.extra, "Invalid delivery fields.");
}
var TEAM_INFO = { White: { name: "Frost Dragon", captain: "Mudassar", short: "FD", motto: "Ice in the veins. Fire at the crease.", crest: "/teams/frost-dragon-refined.webp", color: "#e0e9ff" }, Black: { name: "Onyx Chimera", captain: "Javed", short: "OC", motto: "Strike with power. Finish with venom.", crest: "/teams/shadow-chimera-refined.webp", color: "#e2b86b" }, Blue: { name: "Storm Reaper", captain: "Saad", short: "SR", motto: "Every delivery. A reckoning.", crest: "/teams/azure-reaper-refined.webp", color: "#6397ff" } };
var captains = [{ id: "captain-saad", name: "Saad", team: "Blue" }, { id: "captain-javed", name: "Javed", team: "Black" }, { id: "captain-mudassar", name: "Mudassar", team: "White" }];
function shuffled(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function standings(s) {
  return TEAMS.map((team) => {
    let played = 0, won = 0, tied = 0, runsFor = 0, runsAgainst = 0, ballsFor = 0, ballsAgainst = 0;
    for (const m of s.matches.filter((m2) => m2.label !== "Final" && (m2.home === team || m2.away === team) && phase(s, m2) === 2)) {
      played++;
      const a = summary(m.innings[0]).runs, b = summary(m.innings[1]).runs;
      if (a === b) tied++;
      else if (batting(m, a > b ? 0 : 1) === team) won++;
      for (const i of [0, 1]) {
        const x = summary(m.innings[i]), bat = batting(m, i), allOut = x.wickets >= Math.max(1, s.players.filter((p) => p.team === bat).length - 1), balls = allOut ? m.overs * 6 : x.balls;
        if (bat === team) {
          runsFor += x.runs;
          ballsFor += balls;
        } else {
          runsAgainst += x.runs;
          ballsAgainst += balls;
        }
      }
    }
    const nrr = (ballsFor ? runsFor * 6 / ballsFor : 0) - (ballsAgainst ? runsAgainst * 6 / ballsAgainst : 0);
    return { team, played, won, lost: played - won - tied, points: won * 2 + tied, nrr };
  }).sort((a, b) => b.points - a.points || (Math.abs(b.nrr - a.nrr) > 1e-9 ? b.nrr - a.nrr : 0) || (s.drawOrder || TEAMS).indexOf(a.team) - (s.drawOrder || TEAMS).indexOf(b.team));
}
function syncFinal(s) {
  const league = s.matches.filter((m) => m.label !== "Final"), final = s.matches.find((m) => m.label === "Final");
  if (final?.started) return;
  if (league.length < 3 || !league.every((m) => phase(s, m) === 2)) {
    s.matches = s.matches.filter((m) => m.label !== "Final");
    return;
  }
  if (!s.drawOrder) s.drawOrder = shuffled([...TEAMS]);
  const [a, b] = standings(s);
  if (final) {
    final.home = a.team;
    final.away = b.team;
    final.first = a.team;
    return;
  }
  s.matches.push({ id: crypto.randomUUID(), home: a.team, away: b.team, first: a.team, overs: s.overs, label: "Final", started: false, innings: [[], []] });
}
function apply(state, c) {
  const next = structuredClone(state);
  const s = next.seasons.find((x) => x.id === c.season);
  if (c.type === "season") {
    check(/^\d{4}-\d{2}-\d{2}$/.test(c.date) && (/* @__PURE__ */ new Date(c.date + "T12:00:00Z")).getUTCDay() === 6, "Choose a Saturday.");
    check(!next.seasons.some((x) => x.date === c.date), "A season already exists for this Saturday.");
    check(Number.isInteger(c.overs) && c.overs >= 1 && c.overs <= 50, "Choose 1\u201350 overs.");
    const prev = next.seasons[0];
    next.seasons.unshift({ id: crypto.randomUUID(), number: Math.max(2, ...next.seasons.map((x) => x.number || 0)) + 1, published: false, date: c.date, overs: c.overs, players: structuredClone(captains), points: prev ? { ...defaultPoints, ...prev.points } : { ...defaultPoints }, matches: [] });
    return next;
  }
  check(s, "Season not found.");
  if (c.type === "availability") {
    check(!s.availabilityClosed && !s.squadsPublishedAt && !s.publishedAt && !s.squadsPublished && !s.published && !s.matches.some((m) => m.started), "Squads are already published. Contact Alpha to arrange any change.");
    check(c.status === "available" || c.status === "unavailable", "Choose Available or Not available.");
    check(typeof c.playerId === "string" && c.playerId.length > 0, "Player not found.");
    s.availability = { ...s.availability, [c.playerId]: c.status };
    return next;
  }
  if (["player", "assign", "remove"].includes(c.type)) {
    s.published = false;
    s.squadsPublished = false;
    s.fixturesPublished = false;
  }
  if (c.type === "fixtures") {
    s.fixturesPublished = false;
  }
  if (c.type === "publish-fixtures") {
    check(s.squadsPublished === true || s.published === true, "Publish squads first.");
    check(s.matches.length >= 3, "Draw the fixtures first.");
    s.fixturesPublished = true;
    s.fixturesPublishedAt = Date.now();
  } else if (c.type === "publish-squads" || c.type === "publish") {
    check(TEAMS.every((t) => s.players.filter((p) => p.team === t).length >= 2), "Select at least two players per squad before publishing.");
    check(s.availabilityClosed || !!s.squadsPublishedAt || !!s.publishedAt || s.players.every((p) => s.availability?.[p.id] === "available"), "Confirm availability for every selected player before publishing.");
    s.availabilityClosed = true;
    s.squadsPublished = true;
    s.squadsPublishedAt = Date.now();
    if (c.type === "publish") {
      s.published = true;
      s.publishedAt = Date.now();
      s.fixturesPublished = true;
    }
  } else if (c.type === "player") {
    check(TEAMS.includes(c.team) && typeof c.name === "string" && c.name.trim().length > 0 && c.name.trim().length <= 50, "Enter a player name (up to 50 characters).");
    check(!s.matches.some((m) => m.started), "Squads are locked after the first match starts.");
    check(!s.players.some((p) => p.name.toLowerCase() === c.name.trim().toLowerCase()), "This player is already in the season.");
    check(s.players.filter((p) => p.team === c.team).length < 11, "Each squad supports up to 11 players.");
    s.players.push({ id: crypto.randomUUID(), name: c.name.trim(), team: c.team });
  } else if (c.type === "assign") {
    check(c.team === "unassigned" || s.availabilityClosed || s.squadsPublishedAt || s.publishedAt || s.availability?.[c.player?.id] === "available", "Only confirmed available players can be assigned before publication.");
    check(!s.matches.some((m) => m.started), "Teams are locked after play starts.");
    check(TEAMS.includes(c.team) || c.team === "unassigned", "Choose a valid team.");
    check(typeof c.player?.id === "string" && typeof c.player?.name === "string", "Player not found.");
    check(!captains.some((p) => p.id === c.player.id), "Captains stay with their own teams.");
    check(c.team === "unassigned" || s.players.filter((p) => p.team === c.team && p.id !== c.player.id).length < 11, "A squad can have at most 11 players.");
    s.players = s.players.filter((p) => p.id !== c.player.id);
    if (c.team !== "unassigned") s.players.push({ id: c.player.id, name: c.player.name, team: c.team });
  } else if (c.type === "remove") {
    check(!s.matches.some((m) => m.started), "Squads are locked after play starts.");
    check(!captains.some((p) => p.id === c.player), "Captains stay with their own teams.");
    check(!s.matches.length, "Squads are locked after fixtures are created.");
    s.players = s.players.filter((p) => p.id !== c.player);
  } else if (c.type === "fixtures") {
    check(!s.matches.length, "Fixtures already exist.");
    for (const team of TEAMS) check(s.players.filter((p) => p.team === team).length >= 2, "Add at least two players to each squad first.");
    s.drawOrder = shuffled([...TEAMS]);
    s.matches = shuffled([[TEAMS[0], TEAMS[1]], [TEAMS[1], TEAMS[2]], [TEAMS[2], TEAMS[0]]]).map(([home, away], i) => ({ id: crypto.randomUUID(), home, away, first: home, overs: s.overs, label: `League ${i + 1}`, started: false, innings: [[], []] }));
  } else if (c.type === "final") {
    check(!s.matches.some((m) => m.label === "Final"), "Final already exists.");
    check(s.matches.length >= 3 && s.matches.every((m) => phase(s, m) === 2), "Complete the league matches first.");
    syncFinal(s);
  } else if (c.type === "points") {
    for (const k of Object.keys(defaultPoints)) check(Number.isInteger(c.points[k]) && c.points[k] >= (k === "economyExpensive" ? -100 : 0) && c.points[k] <= 100, "Check the point values. Bonuses must be 0\u2013100; the high-economy penalty may be negative.");
    check(c.points.economyMinOvers >= 1 && c.points.economyMinOvers <= 10, "Economy qualification must be 1\u201310 overs.");
    s.points = c.points;
  } else {
    const m = s.matches.find((m2) => m2.id === c.match);
    check(m, "Match not found.");
    if (c.type === "start") {
      check(!m.started, "Match has already started.");
      check(s.matches.slice(0, s.matches.indexOf(m)).every((x) => phase(s, x) === 2), "Play the fixtures in their drawn order.");
      check(c.first === m.home || c.first === m.away, "Choose the batting team.");
      check(Number.isInteger(c.overs) && c.overs >= 1 && c.overs <= 50, "Choose 1\u201350 overs.");
      check(!s.matches.some((o) => o.id !== m.id && phase(s, o) >= 0 && phase(s, o) < 2), "Finish the live match first.");
      for (const t of [m.home, m.away]) check(s.players.filter((p) => p.team === t).length >= 2, "Each team needs at least two players.");
      m.first = c.first;
      m.overs = c.overs;
      m.started = true;
      m.pauseBetweenInnings = c.pauseBetweenInnings === true;
      m.secondInningsStarted = false;
    } else if (c.type === "next-innings") {
      check(phase(s, m) === 1 && !m.innings[1].length && !m.secondInningsStarted, "Next innings is not awaiting a start.");
      m.secondInningsStarted = true;
    } else if (c.type === "ball") {
      validateBall(s, m, c.ball);
      m.innings[phase(s, m)].push(c.ball);
    } else if (c.type === "dead") {
      const i = phase(s, m);
      check(i === 0 || i === 1, "Start a live innings first.");
      check(i !== 1 || !m.pauseBetweenInnings || m.secondInningsStarted, "Start the next innings before scoring.");
      (m.deadBalls ??= []).push({ innings: i, afterBall: m.innings[i].length });
    } else if (c.type === "undo") {
      check(!s.matches.some((o) => o.id !== m.id && o.started && s.matches.indexOf(o) > s.matches.indexOf(m)), "Cannot undo after the next match has started.");
      const i = m.innings[1].length ? 1 : 0, d = m.deadBalls?.at(-1);
      if (d && (d.innings > i || d.innings === i && d.afterBall === m.innings[i].length)) m.deadBalls.pop();
      else {
        check(m.innings[i].length, "No deliveries to undo.");
        m.innings[i].pop();
      }
      if (phase(s, m) === 0) m.secondInningsStarted = false;
    } else throw new Error("Unknown action.");
  }
  syncFinal(s);
  return next;
}

// server/render/push.ts
var moduleName = "web-push";
async function provider() {
  const m = await import(moduleName);
  return m.default || m;
}
async function keys() {
  const db = database();
  let row = await db.prepare("SELECT data FROM push_settings WHERE id=?").bind("vapid").first();
  if (!row) {
    const wp = await provider();
    await db.prepare("INSERT OR IGNORE INTO push_settings (id,data) VALUES (?,?)").bind("vapid", JSON.stringify(wp.generateVAPIDKeys())).run();
    row = await db.prepare("SELECT data FROM push_settings WHERE id=?").bind("vapid").first();
  }
  return JSON.parse(row.data);
}
async function pushKey() {
  return (await keys()).publicKey;
}
async function saveSubscription(user, player, sub) {
  let url;
  try {
    url = new URL(sub?.endpoint);
  } catch {
    throw Error("Invalid push endpoint.");
  }
  const h = url.hostname;
  if (url.protocol !== "https:" || url.port || !(h === "fcm.googleapis.com" || h === "updates.push.services.mozilla.com" || h.endsWith(".push.services.mozilla.com") || h === "web.push.apple.com" || h.endsWith(".push.apple.com") || h.endsWith(".notify.windows.com"))) throw Error("Unsupported push provider.");
  if (typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string" || sub.endpoint.length > 2e3 || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) throw Error("Invalid push subscription.");
  await database().prepare("INSERT INTO push_subscriptions (endpoint,user_id,player_id,data,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,player_id=excluded.player_id,data=excluded.data,updated_at=excluded.updated_at").bind(sub.endpoint, user, player, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }), Date.now()).run();
}
async function removeSubscription(user, endpoint) {
  await database().prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?").bind(endpoint, user).run();
}
async function notifySquads(s) {
  const db = database(), wp = await provider(), vapid = await keys(), rows = await db.prepare("SELECT endpoint,player_id,data FROM push_subscriptions").all();
  let sent = 0, failed = 0;
  const send = async (row) => {
    const player = s.players.find((p) => p.id === row.player_id);
    if (!player) return;
    const tag = `squad-${s.id}-${player.id}-${s.squadsPublishedAt || s.publishedAt || 0}`;
    const id = tag + ":" + row.endpoint;
    try {
      const exists = await db.prepare("SELECT id FROM push_deliveries WHERE id=?").bind(id).first();
      if (exists) return;
      await wp.sendNotification(JSON.parse(row.data), JSON.stringify({ title: `Your colours are here: ${TEAM_INFO[player.team].name} \u{1F3CF}`, body: `Welcome to the ${TEAM_INFO[player.team].name} dressing room, ${player.name}. Season ${s.number} awaits. Tap to meet your squad.`, tag, url: "/", icon: TEAM_INFO[player.team].crest }), { vapidDetails: { subject: "https://royal-rangers.vercel.app", ...vapid }, TTL: 86400, timeout: 5e3 });
      await db.prepare("INSERT OR IGNORE INTO push_deliveries (id,created_at) VALUES (?,?)").bind(id, Date.now()).run();
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) await db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").bind(row.endpoint).run();
    }
  };
  for (let i = 0; i < rows.results.length; i += 4) await Promise.all(rows.results.slice(i, i + 4).map(send));
  return { sent, failed };
}
async function notifyAttendance(now = Date.now()) {
  const db = database();
  const records = await db.prepare("SELECT data FROM seasons").all();
  const season = records.results.map((r) => JSON.parse(r.data)).sort((a, b) => (b.number || 0) - (a.number || 0) || b.date.localeCompare(a.date))[0];
  if (!season) return { sent: 0, failed: 0, eligible: 0 };
  const rows = await db.prepare("SELECT s.endpoint,s.player_id,s.data,p.name FROM push_subscriptions s JOIN player_registrations r ON r.player_id=s.player_id AND r.user_id=s.user_id JOIN approved_players p ON p.id=r.player_id").all();
  let sent = 0, failed = 0, eligible = 0;
  const wp = await provider(), vapid = await keys();
  for (const row of rows.results) {
    const fresh = await db.prepare("SELECT data FROM seasons WHERE id=?").bind(season.id).first();
    if (!fresh) continue;
    const message = attendanceReminder(JSON.parse(fresh.data), row.player_id, now, row.name);
    if (!message) continue;
    eligible++;
    const id = `attendance:${season.id}:${row.endpoint}`;
    const claim = await db.prepare("INSERT INTO push_deliveries (id,created_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at WHERE push_deliveries.created_at<=? RETURNING id").bind(id, now, now - ATTENDANCE_REMINDER_MS).first();
    if (!claim) continue;
    try {
      await wp.sendNotification(JSON.parse(row.data), JSON.stringify(message), { vapidDetails: { subject: "https://royal-rangers.vercel.app", ...vapid }, TTL: 3600, timeout: 5e3 });
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) await db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").bind(row.endpoint).run();
    }
  }
  return { sent, failed, eligible };
}

// server/render/attendance-worker.ts
var timer;
var running = false;
var attendanceWorkerStatus = { lastRun: null, sent: 0, failed: 0, eligible: 0, resetCount: null, error: false };
function startAttendanceReminders() {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (!await migrationStatus()) return;
      const reset = await resetAttendanceOnce("rr-season-3", "attendance-reset-2026-09-16-v1");
      attendanceWorkerStatus.resetCount = reset.count;
      Object.assign(attendanceWorkerStatus, await notifyAttendance(), { lastRun: Date.now(), error: false });
    } catch (e) {
      attendanceWorkerStatus.error = true;
      console.error("Royal Rangers attendance reminders:", e instanceof Error ? e.message : "failed");
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), 6e4);
  timer.unref();
  void tick();
}

// app/api/push/route.ts
var route_exports = {};
__export(route_exports, {
  GET: () => GET,
  POST: () => POST
});

// server/render/env.ts
var env = { get COMMITTEE_CODE_HASH() {
  return process.env.RR_COMMITTEE_CODE_HASH;
} };

// server/backend.ts
async function renderBackend(req) {
  const base = env.RR_RENDER_BACKEND;
  if (!base) return null;
  try {
    const h = new Headers(req.headers);
    h.delete("host");
    h.delete("content-length");
    const r = await fetch(base + new URL(req.url).pathname, { method: req.method, headers: h, ...["GET", "HEAD"].includes(req.method) ? {} : { body: await req.text() }, redirect: "manual" });
    return new Response(r.body, { status: r.status, headers: r.headers });
  } catch {
    return Response.json({ error: "Scores are temporarily unavailable. Please retry." }, { status: 503 });
  }
}

// server/access.ts
var AccessError = class extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
};
function sameOrigin(req) {
  const origin = req.headers.get("origin");
  const allowed = [new URL(req.url).origin, "https://royal-rangers.vercel.app", "https://royal-rangers-saturday-cricket.advancedtradingmart.chatgpt.site"];
  if (origin && !allowed.includes(origin)) throw new AccessError("Invalid request origin.");
  if (!origin && req.headers.get("sec-fetch-site") === "cross-site") throw new AccessError("Invalid request origin.");
}
var cookieValue = (req, name) => req.headers.get("cookie")?.split(";").map((x) => x.trim()).find((x) => x.startsWith(name + "="))?.slice(name.length + 1);
function sessionCookie(req, name, value, age) {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function passwordHash(password, salt = crypto.randomUUID()) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bytes = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 1e5, hash: "SHA-256" }, key, 256);
  return salt + ":" + [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifyPassword(password, hash) {
  const [salt, expected] = hash.split(":");
  if (!salt || !expected) return false;
  const actual = (await passwordHash(password, salt)).split(":")[1];
  let mismatch = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ (expected.charCodeAt(i) || 0);
  return mismatch === 0;
}
async function rateLimit(key, limit = 5, windowMs = 15 * 6e4) {
  const db = database(), now = Date.now();
  await db.prepare("INSERT INTO access_attempts (id, attempts, reset_at) VALUES (?, 0, ?) ON CONFLICT(id) DO UPDATE SET attempts = CASE WHEN access_attempts.reset_at < ? THEN 0 ELSE access_attempts.attempts END, reset_at = CASE WHEN access_attempts.reset_at < ? THEN excluded.reset_at ELSE access_attempts.reset_at END").bind(key, now + windowMs, now, now).run();
  const attempt = await db.prepare("UPDATE access_attempts SET attempts = attempts + 1 WHERE id = ? AND attempts < ? RETURNING attempts").bind(key, limit).first();
  if (!attempt) throw new AccessError("Too many attempts. Please try again later.", 429);
}
async function digest(s) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function actor(req) {
  const token = cookieValue(req, "rr_member");
  const member = token ? await database().prepare("SELECT m.id,m.name,m.player_id FROM member_sessions s JOIN members m ON m.id=s.user_id WHERE s.token=? AND s.expires>? AND (m.id=? OR EXISTS (SELECT 1 FROM player_registrations r JOIN approved_players p ON p.id=r.player_id WHERE r.user_id=m.id AND r.player_id=m.player_id))").bind(await digest(token), Date.now(), "committee-alpha").first() : null;
  if (!member) return { user: null, member: null, committee: null };
  const user = { userId: member.id, displayName: member.name };
  const committeeToken = cookieValue(req, "rr_committee");
  const seat = committeeToken ? await database().prepare("SELECT COALESCE(s.committee_name,c.name) AS name FROM committee_sessions s LEFT JOIN committee_seats c ON c.user_id = s.user_id WHERE s.token = ? AND s.user_id = ? AND s.expires > ?").bind(await digest(committeeToken), user.userId, Date.now()).first() : null;
  return { user, member, committee: member.id === "committee-alpha" && seat ? "Alpha" : null };
}
async function committee(req) {
  sameOrigin(req);
  const a = await actor(req);
  if (!a.user) throw new AccessError("Log in to Royal Rangers first.", 401);
  if (a.user.userId !== "committee-alpha" || a.committee !== "Alpha") throw new AccessError("Only the core committee can manage the league.");
  return a;
}
async function codeMatches(code) {
  const value = env.COMMITTEE_CODE_HASH;
  if (!value) throw new AccessError("Committee access is not configured yet.", 503);
  const [salt, expected] = value.split(":");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"]);
  const bytes = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 1e5, hash: "SHA-256" }, key, 256);
  const actual = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  let mismatch = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ (expected.charCodeAt(i) || 0);
  return mismatch === 0;
}
function failure(e) {
  console.error(e instanceof Error ? e.message : "Request failed");
  return Response.json({ error: e instanceof Error ? e.message : "Request failed." }, { status: e instanceof AccessError ? e.status : 400, headers: { "Cache-Control": "no-store" } });
}

// app/api/push/route.ts
var headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
async function GET(req) {
  const remote = await renderBackend(req);
  if (remote) return remote;
  try {
    return Response.json({ publicKey: await pushKey() }, { headers });
  } catch (e) {
    return failure(e);
  }
}
async function POST(req) {
  const remote = await renderBackend(req);
  if (remote) return remote;
  try {
    sameOrigin(req);
    const a = await actor(req);
    if (!a.user || !a.member?.player_id) throw new AccessError("Log in with your player account to enable squad alerts.", 401);
    await rateLimit("push:" + a.user.userId, 60);
    const raw = await req.text();
    if (raw.length > 5e3) throw new AccessError("Subscription too large.", 413);
    const body = JSON.parse(raw);
    if (body.type === "unsubscribe") await removeSubscription(a.user.userId, String(body.endpoint));
    else await saveSubscription(a.user.userId, a.member.player_id, body.subscription);
    return Response.json({ ok: true }, { headers });
  } catch (e) {
    return failure(e);
  }
}

// app/api/tournament/route.ts
var route_exports2 = {};
__export(route_exports2, {
  GET: () => GET2,
  POST: () => POST2,
  dynamic: () => dynamic
});

// server/publication.ts
function seasonPublished(s) {
  return s.squadsPublished ?? s.published === true;
}
function visibleTournament(state, viewer) {
  const privileged = viewer.userId === "committee-alpha" && viewer.committee === "Alpha" || !!viewer.userId && captains.some((p) => p.id === viewer.playerId);
  return { seasons: state.seasons.map((s, index) => {
    const historical = index > 0 && s.published === void 0 && s.squadsPublished === void 0 && s.matches.some((m) => m.started);
    const squads = privileged || historical || seasonPublished(s);
    const fixtures = squads && (privileged || historical || (s.fixturesPublished ?? s.published === true));
    return { availabilityClosed: !!(s.availabilityClosed || s.squadsPublishedAt || s.publishedAt || seasonPublished(s) || s.matches.some((m) => m.started)), availability: viewer.userId === "committee-alpha" && viewer.committee === "Alpha" ? s.availability : viewer.playerId && s.availability?.[viewer.playerId] ? { [viewer.playerId]: s.availability[viewer.playerId] } : {}, id: s.id, number: s.number, date: s.date, overs: s.overs, points: s.points, published: s.published, squadsPublished: s.squadsPublished, fixturesPublished: s.fixturesPublished, squadsPublishedAt: squads ? s.squadsPublishedAt : void 0, publicationHidden: !squads, fixturesHidden: !fixtures, players: squads ? s.players : [], matches: fixtures ? s.matches : [], ...fixtures ? { drawOrder: s.drawOrder } : {} };
  }) };
}

// server/balance.ts
var attrs = ["batting", "bowling", "fielding", "attitude"];
function balancedSquads(pool2, ids, random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) {
  const selected = [.../* @__PURE__ */ new Set([...captains.map((c) => c.id), ...ids])];
  if (selected.length < 6 || selected.length > 33) throw new Error("Select 6 to 33 available players, including the three captains.");
  if (selected.some((id) => !pool2.some((p) => p.id === id))) throw new Error("A selected player is not in the current ratings pool. Reload the committee room.");
  const players = selected.map((id) => pool2.find((p) => p.id === id));
  const means = attrs.map((a) => {
    const v = pool2.map((p) => p.averages[a]).filter((n) => n !== null);
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 1.5;
  });
  const vectors = new Map(players.map((p) => [p.id, attrs.map((a, i) => p.averages[a] ?? means[i])]));
  const targets = attrs.map((_, i) => players.reduce((s, p) => s + vectors.get(p.id)[i], 0) / 3);
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const loose = players.filter((p) => !captains.some((c) => c.id === p.id));
  let best = [], bestLoss = Infinity;
  for (let attempt = 0; attempt < 100; attempt++) {
    const order = shuffle([...TEAMS]), sizes = Object.fromEntries(TEAMS.map((t) => [t, Math.floor(players.length / 3)]));
    for (let i = 0; i < players.length % 3; i++) sizes[order[i]]++;
    const slots = shuffle(TEAMS.flatMap((t) => Array.from({ length: sizes[t] - 1 }, () => t)));
    const deal = [...captains.map((p) => ({ ...p })), ...shuffle([...loose]).map((p, i) => ({ id: p.id, name: p.name, team: slots[i] }))];
    const loss = () => {
      const totals = TEAMS.map((t) => attrs.map((_, i) => deal.filter((p) => p.team === t).reduce((s, p) => s + vectors.get(p.id)[i], 0)));
      return totals.reduce((sum, v) => sum + v.reduce((s, n, i) => s + ((n - targets[i]) / Math.max(1, targets[i])) ** 2, 0), 0);
    };
    let score = loss();
    for (let step = 0; step < 160; step++) {
      const i = 3 + Math.floor(random() * (deal.length - 3)), j = 3 + Math.floor(random() * (deal.length - 3));
      if (deal[i].team === deal[j].team) continue;
      [deal[i].team, deal[j].team] = [deal[j].team, deal[i].team];
      const next = loss();
      if (next <= score) score = next;
      else [deal[i].team, deal[j].team] = [deal[j].team, deal[i].team];
    }
    if (score < bestLoss) {
      bestLoss = score;
      best = deal;
    }
  }
  return best;
}

// lib/scoring-access.ts
function scoringAllowed(userId, name, _match) {
  return userId === "committee-alpha" && name === "Alpha";
}

// server/ratings-source.json
var ratings_source_default = JSON.parse(process.env.RR_RATINGS_SOURCE || "{}");

// server/players.ts
var normalizeName = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");
var aliases = { saad: { id: "captain-saad", name: "Saad" }, muddi: { id: "captain-mudassar", name: "Mudassar" }, guddu: { id: "captain-javed", name: "Javed" } };
async function approvedPlayers() {
  const db = database(), seed = ratings_source_default.players.map((p) => aliases[normalizeName(p.name)] || { id: p.id, name: p.name.trim() });
  await db.prepare("INSERT OR IGNORE INTO approved_players (id,name,name_key,created_at) VALUES " + seed.map(() => "(?,?,?,?)").join(",")).bind(...seed.flatMap((p) => [p.id, p.name, normalizeName(p.name), Date.now()])).run();
  await db.prepare("INSERT OR IGNORE INTO player_registrations (player_id,user_id,created_at) SELECT m.player_id,m.id,m.created_at FROM members m JOIN credentials c ON c.user_id=m.id JOIN approved_players p ON p.id=m.player_id ORDER BY m.created_at,m.id").run();
  const rows = await db.prepare("SELECT p.id,p.name,r.user_id,c.username,r.created_at AS registered_at FROM approved_players p LEFT JOIN player_registrations r ON r.player_id=p.id LEFT JOIN credentials c ON c.user_id=r.user_id ORDER BY p.name").all();
  return rows.results;
}
async function addApprovedPlayer(name) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 50) throw new Error("Enter a player name up to 50 characters.");
  const clean = name.trim().replace(/\s+/g, " "), key = normalizeName(clean);
  await approvedPlayers();
  if (["alpha", "muddi", "guddu", "guddu bhai"].includes(key)) throw new Error("This name is reserved or already exists under the captain's full name.");
  const id = "rated-" + crypto.randomUUID();
  try {
    await database().prepare("INSERT INTO approved_players (id,name,name_key,created_at) VALUES (?,?,?,?)").bind(id, clean, key, Date.now()).run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new AccessError("This player is already in the approved list.", 409);
    throw e;
  }
  return { id, name: clean };
}
async function registerPlayer(playerId, username, password) {
  if (typeof username !== "string" || !/^[-a-z0-9_]{3,30}$/.test(username.trim().toLowerCase())) throw new Error("Use a username of 3-30 letters, numbers, underscores or hyphens.");
  const login = username.trim().toLowerCase();
  if (login === "alpha") throw new Error("Alpha is reserved for committee access.");
  if (typeof password !== "string" || password.length < 10 || password.length > 128) throw new Error("Choose a password of 10-128 characters.");
  const players = await approvedPlayers(), player = players.find((p) => p.id === playerId);
  if (!player) throw new AccessError("Select your name from the approved player list.");
  if (player.user_id) throw new AccessError("This player is already registered. Please log in.", 409);
  const db = database(), userId = crypto.randomUUID(), now = Date.now(), hash = await passwordHash(password);
  try {
    await db.batch([db.prepare("INSERT INTO player_registrations (player_id,user_id,created_at) VALUES (?,?,?)").bind(player.id, userId, now), db.prepare("INSERT INTO members (id,name,player_id,created_at) VALUES (?,?,?,?)").bind(userId, player.name, player.id, now), db.prepare("INSERT INTO credentials (user_id,username,password_hash,created_at) VALUES (?,?,?,?)").bind(userId, login, hash, now)]);
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new AccessError("This player or username is already registered. Please log in or choose another username.", 409);
    throw e;
  }
  return userId;
}
async function unregisterPlayer(playerId, expectedUserId) {
  const player = (await approvedPlayers()).find((p) => p.id === playerId);
  if (!player) throw new AccessError("Approved player not found.", 404);
  if (!player.user_id || player.user_id !== expectedUserId) throw new AccessError("Registration changed. Reload before resetting.", 409);
  if (player.user_id === "committee-alpha") throw new AccessError("Committee access cannot be reset here.");
  const db = database(), userId = player.user_id;
  await db.batch([
    db.prepare("DELETE FROM member_sessions WHERE user_id=?").bind(userId),
    db.prepare("DELETE FROM committee_sessions WHERE user_id=?").bind(userId),
    db.prepare("DELETE FROM committee_seats WHERE user_id=?").bind(userId),
    db.prepare("DELETE FROM push_subscriptions WHERE user_id=?").bind(userId),
    db.prepare("DELETE FROM credentials WHERE user_id=?").bind(userId),
    db.prepare("DELETE FROM player_registrations WHERE player_id=? AND user_id=?").bind(player.id, userId),
    db.prepare("DELETE FROM members WHERE id=?").bind(userId),
    db.prepare("INSERT INTO audit_log (id,actor,action,created_at) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "Alpha", "Reset registration: " + player.name, Date.now())
  ]);
  return { id: player.id, name: player.name };
}

// server/ratings.ts
var ATTRIBUTES = ["batting", "bowling", "fielding", "attitude"];
var aliases2 = { saad: { id: "captain-saad", name: "Saad" }, muddi: { id: "captain-mudassar", name: "Mudassar" }, guddu: { id: "captain-javed", name: "Javed" } };
var reviewers = { "SAAD": "Saad", "MUDDI": "Mudassar", "GUDDU BHAI": "Javed" };
async function readRatings() {
  const db = database();
  await db.prepare("INSERT OR IGNORE INTO private_ratings (id, data, revision) VALUES (?, ?, 0)").bind("roster", JSON.stringify({ source: ratings_source_default, overrides: {} })).run();
  const row = await db.prepare("SELECT data, revision FROM private_ratings WHERE id = ?").bind("roster").first();
  if (!row) throw new Error("Ratings are unavailable.");
  let data = JSON.parse(row.data), revision = row.revision;
  if (data.source.version !== ratings_source_default.version) {
    const refreshed = { source: ratings_source_default, overrides: {}, previousImport: { source: data.source, overrides: data.overrides } };
    const updated = await db.prepare("UPDATE private_ratings SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?").bind(JSON.stringify(refreshed), "roster", revision).run();
    if (!updated.meta.changes) return readRatings();
    data = refreshed;
    revision++;
  }
  const approved = await approvedPlayers();
  const sourcePlayers = [...data.source.players, ...approved.filter((p) => !data.source.players.some((r) => (aliases2[r.name.toLowerCase()]?.id || r.id) === p.id)).map((p) => ({ id: p.id, name: p.name, reviews: [] }))];
  const players = sourcePlayers.map((p) => {
    const identity = aliases2[p.name.toLowerCase()] || { id: p.id, name: p.name };
    const reviews = ["Saad", "Mudassar", "Javed", "Alpha"].map((reviewer) => {
      const r = p.reviews.find((r2) => (reviewers[r2.reviewer] || r2.reviewer) === reviewer);
      const original = Object.fromEntries(ATTRIBUTES.map((a) => [a, r?.values[a] ?? null]));
      const values = Object.fromEntries(ATTRIBUTES.map((attr) => {
        const key = `${identity.id}:${reviewer}:${attr}`;
        return [attr, Object.hasOwn(data.overrides, key) ? data.overrides[key] : original[attr]];
      }));
      return { reviewer, values, original, cells: r?.cells || null };
    });
    const averages = Object.fromEntries(ATTRIBUTES.map((attr) => {
      const values = reviews.map((r) => r.values[attr]).filter((v) => typeof v === "number" && v >= 0 && v <= 3);
      return [attr, values.length ? values.reduce((a, b) => a + b, 0) / values.length : null];
    }));
    return { ...identity, sourceName: p.name, reviews, averages, total: ATTRIBUTES.every((a) => averages[a] !== null) ? ATTRIBUTES.reduce((sum, a) => sum + averages[a], 0) : null };
  });
  return { data, revision, players };
}

// app/api/tournament/route.ts
var dynamic = "force-dynamic";
var headers2 = { "Cache-Control": "private, no-store", Vary: "Cookie" };
async function read() {
  const db = database();
  const [meta, records] = await db.batch([db.prepare("SELECT revision FROM tournaments WHERE id = ?").bind("royal-rangers"), db.prepare("SELECT data FROM seasons")]);
  return { revision: Number(meta.results[0]?.revision ?? 0), state: { seasons: records.results.map((r) => JSON.parse(String(r.data))).sort((a, b) => (b.number || 0) - (a.number || 0) || b.date.localeCompare(a.date)) } };
}
async function initialize2() {
  const db = database();
  await db.prepare("INSERT OR IGNORE INTO tournaments (id, data, revision) VALUES (?, ?, 0)").bind("royal-rangers", "{}").run();
  await db.prepare("INSERT OR IGNORE INTO seasons (id, data) VALUES (?, ?)").bind("rr-season-3", JSON.stringify({ id: "rr-season-3", number: 3, date: saturday(), overs: 10, players: captains, points: defaultPoints, matches: [] })).run();
}
async function GET2(req) {
  const remote = await renderBackend(req);
  if (remote) return remote;
  try {
    await initialize2();
    const snapshot = await read(), a = await actor(req);
    return Response.json({ ...snapshot, state: visibleTournament(snapshot.state, { userId: a.user?.userId, committee: a.committee, playerId: a.member?.player_id }) }, { headers: headers2 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Unable to load scores. Please retry." }, { status: 503, headers: headers2 });
  }
}
async function POST2(req) {
  const remote = await renderBackend(req);
  if (remote) return remote;
  try {
    sameOrigin(req);
    const raw = await req.text();
    if (raw.length > 2e4) return Response.json({ error: "Request too large." }, { status: 413 });
    const { command, revision } = JSON.parse(raw);
    if (!command || !Number.isInteger(revision)) throw new Error("Invalid request.");
    const a = command.type === "availability" ? await actor(req) : await committee(req);
    if (command.type === "availability") {
      if (!a.user) throw new AccessError("Log in to record your availability.", 401);
      if (a.committee !== "Alpha") {
        if (!a.member?.player_id) throw new AccessError("A registered player account is required.");
        command.playerId = a.member.player_id;
      } else {
        const ratings = await readRatings();
        if (!ratings.players.some((p) => p.id === command.playerId)) throw new Error("Player not found.");
      }
    }
    await initialize2();
    const db = database();
    const current = await read();
    if (current.revision !== revision) return Response.json({ error: "Scores changed in another tab. Reload the latest scores before continuing." }, { status: 409 });
    if (["start", "next-innings", "ball", "undo", "dead"].includes(command.type)) {
      const match = current.state.seasons.find((s) => s.id === command.season)?.matches.find((m) => m.id === command.match);
      if (!match) throw new Error("Match not found.");
      if (!scoringAllowed(a.user.userId, a.committee, match)) throw new AccessError("Only alpha can start, score or undo this match.");
    }
    if (command.type === "assign") {
      const ratings = await readRatings();
      const player = ratings.players.find((p) => p.id === command.playerId);
      if (!player) throw new Error("Player not found in the private selection pool.");
      command.player = { id: player.id, name: player.name };
    }
    let state;
    if (command.type === "balance") {
      const season = current.state.seasons.find((s) => s.id === command.season);
      if (!season) throw new Error("Season not found.");
      if (season.matches.some((m) => m.started)) throw new AccessError("Squads are locked after play starts.");
      if (!Array.isArray(command.playerIds) || command.playerIds.length > 33 || command.playerIds.some((id) => typeof id !== "string")) throw new Error("Choose the available players.");
      const ratings = await readRatings();
      if (command.ratingsRevision !== ratings.revision) return Response.json({ error: "Ratings changed. Reload the committee room before balancing." }, { status: 409 });
      if (season.availabilityClosed || season.squadsPublishedAt || season.publishedAt || season.squadsPublished || season.published) throw new Error("Squads have been published. Make replacements manually.");
      if (command.playerIds.some((id) => season.availability?.[id] !== "available")) throw new Error("Only confirmed available players can be balanced. Reload availability before selecting.");
      const players = balancedSquads(ratings.players, command.playerIds);
      state = structuredClone(current.state);
      state.seasons.find((s) => s.id === command.season).players = players;
      state.seasons.find((s) => s.id === command.season).published = false;
      state.seasons.find((s) => s.id === command.season).squadsPublished = false;
      state.seasons.find((s) => s.id === command.season).fixturesPublished = false;
    } else state = apply(current.state, command);
    const changed = command.type === "season" ? state.seasons[0] : state.seasons.find((s) => s.id === command.season);
    const saved = await db.batch([db.prepare("INSERT INTO seasons (id, data) SELECT ?, ? WHERE (SELECT revision FROM tournaments WHERE id = ?) = ? ON CONFLICT(id) DO UPDATE SET data = excluded.data").bind(changed.id, JSON.stringify(changed), "royal-rangers", revision), db.prepare("UPDATE tournaments SET revision = revision + 1 WHERE id = ? AND revision = ?").bind("royal-rangers", revision)]);
    if (!saved[1].meta.changes) return Response.json({ error: "Another scorer just saved. Reload before continuing." }, { status: 409 });
    await db.prepare("INSERT INTO audit_log (id, actor, action, season, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), a.committee || a.member.name, command.type === "availability" ? `availability: ${command.playerId} ${command.status}` : command.type, changed.id, Date.now()).run();
    const pushDelivery = ["publish-squads", "publish"].includes(command.type) ? await notifySquads(changed).catch(() => ({ sent: 0, failed: 1 })) : void 0;
    return Response.json({ state: visibleTournament(state, { userId: a.user?.userId, committee: a.committee, playerId: a.member?.player_id }), revision: revision + 1, pushDelivery }, { headers: headers2 });
  } catch (e) {
    return failure(e);
  }
}

// app/api/member/route.ts
var route_exports3 = {};
__export(route_exports3, {
  GET: () => GET3,
  POST: () => POST3,
  dynamic: () => dynamic2
});
var dynamic2 = "force-dynamic";
var response = (data, headers3 = {}) => {
  const h = new Headers(headers3);
  h.set("Cache-Control", "no-store");
  return Response.json(data, { headers: h });
};
async function loginSession(req, userId) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await database().prepare("INSERT INTO member_sessions (token,user_id,expires) VALUES (?,?,?)").bind(await digest(token), userId, Date.now() + 30 * 864e5).run();
  const h = new Headers();
  h.append("Set-Cookie", sessionCookie(req, "rr_member", token, 30 * 86400));
  h.append("Set-Cookie", sessionCookie(req, "rr_committee", "", 0));
  return response({ ok: true }, h);
}
async function GET3(req) {
  const remote = await renderBackend(req);
  if (remote) return remote;
  try {
    const players = await approvedPlayers();
    const a = await actor(req);
    return response({ signedIn: !!a.user, name: a.member?.name || "", registered: !!a.member, playerId: a.member?.player_id || null, committee: a.committee, scorer: a.committee, players: players.map((p) => ({ id: p.id, name: p.name, registered: !!p.user_id })) });
  } catch (e) {
    return failure(e);
  }
}
async function POST3(req) {
  const remote = await renderBackend(req);
  if (remote) return remote;
  try {
    sameOrigin(req);
    const raw = await req.text();
    if (raw.length > 12e3) throw new AccessError("Request too large.", 413);
    const c = JSON.parse(raw);
    const db = database();
    if (c.type === "committee-login") {
      await rateLimit("committee-login:" + (req.headers.get("cf-connecting-ip") || "local"), 30);
      if (c.username?.trim().toLowerCase() !== "alpha" || typeof c.password !== "string" || c.password.length > 128 || !await codeMatches(c.password)) throw new AccessError("Incorrect committee username or password.", 401);
      const userId = "committee-alpha", memberToken = crypto.randomUUID() + crypto.randomUUID(), committeeToken = crypto.randomUUID() + crypto.randomUUID();
      await db.batch([db.prepare("INSERT OR IGNORE INTO members (id,name,created_at) VALUES (?,?,?)").bind(userId, "Alpha", Date.now()), db.prepare("DELETE FROM committee_sessions WHERE user_id=?").bind(userId), db.prepare("DELETE FROM member_sessions WHERE user_id=?").bind(userId), db.prepare("INSERT INTO member_sessions (token,user_id,expires) VALUES (?,?,?)").bind(await digest(memberToken), userId, Date.now() + 432e5), db.prepare("INSERT INTO committee_sessions (token,user_id,committee_name,expires) VALUES (?,?,?,?)").bind(await digest(committeeToken), userId, "Alpha", Date.now() + 432e5)]);
      const h = new Headers();
      h.append("Set-Cookie", sessionCookie(req, "rr_member", memberToken, 43200));
      h.append("Set-Cookie", sessionCookie(req, "rr_committee", committeeToken, 43200));
      return response({ ok: true }, h);
    }
    if (c.type === "signup" || c.type === "login") {
      const username = c.username?.trim().toLowerCase();
      if (!username || !/^[-a-z0-9_]{3,30}$/.test(username)) throw new Error("Enter a valid username.");
      if (username === "alpha") throw new Error("Use Committee access for alpha.");
      if (typeof c.password !== "string" || !c.password || c.password.length > 128) throw new Error("Enter your password.");
      await rateLimit("login:" + username, 10);
      await rateLimit("auth-ip:" + (req.headers.get("cf-connecting-ip") || "local"), 100);
      if (c.type === "signup") {
        const userId = await registerPlayer(c.playerId, username, c.password);
        return loginSession(req, userId);
      }
      await approvedPlayers();
      const existing = await db.prepare("SELECT c.user_id,c.password_hash FROM credentials c JOIN player_registrations r ON r.user_id=c.user_id JOIN approved_players p ON p.id=r.player_id WHERE c.username=?").bind(username).first();
      const valid = await verifyPassword(c.password, existing?.password_hash || "absent:0");
      if (!existing || !valid) throw new AccessError("Incorrect username or password, or player not registered.", 401);
      await db.prepare("DELETE FROM access_attempts WHERE id=?").bind("login:" + username).run();
      return loginSession(req, existing.user_id);
    }
    if (c.type === "logout") {
      await db.batch([db.prepare("DELETE FROM member_sessions WHERE token=?").bind(await digest(cookieValue(req, "rr_member") || "")), db.prepare("DELETE FROM committee_sessions WHERE token=?").bind(await digest(cookieValue(req, "rr_committee") || ""))]);
      const h = new Headers();
      h.append("Set-Cookie", sessionCookie(req, "rr_member", "", 0));
      h.append("Set-Cookie", sessionCookie(req, "rr_committee", "", 0));
      return response({ ok: true }, h);
    }
    if (c.type === "lock") {
      await committee(req);
      await db.prepare("DELETE FROM committee_sessions WHERE token=?").bind(await digest(cookieValue(req, "rr_committee") || "")).run();
      return response({ ok: true }, { "Set-Cookie": sessionCookie(req, "rr_committee", "", 0) });
    }
    throw new AccessError("Player identities cannot be changed after registration. Contact the committee.");
  } catch (e) {
    return failure(e);
  }
}

// app/api/committee/route.ts
var route_exports4 = {};
__export(route_exports4, {
  GET: () => GET4,
  POST: () => POST4,
  dynamic: () => dynamic3
});
var dynamic3 = "force-dynamic";
async function GET4(req) {
  const remote = await renderBackend(req);
  if (remote) return remote;
  try {
    const a = await committee(req);
    const ratings = await readRatings();
    const users = await approvedPlayers();
    const log = await database().prepare("SELECT actor, action, season, created_at FROM audit_log ORDER BY created_at DESC LIMIT 20").all();
    return Response.json({ revision: ratings.revision, players: ratings.players, reviewer: a.committee, audit: log.results, users, source: { name: "team review.xlsx", sheet: "Sheet1", range: ratings.data.source.range, version: ratings.data.source.version, scale: "0 worst \xB7 1 developing \xB7 2 best \xB7 3 exceptional" } }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}
async function POST4(req) {
  const remote = await renderBackend(req);
  if (remote) return remote;
  try {
    const a = await committee(req);
    const c = await req.json();
    if (c.type === "unregister-player") {
      const player = await unregisterPlayer(c.playerId, c.expectedUserId);
      return Response.json({ ok: true, player });
    }
    if (c.type === "add-player") {
      const player = await addApprovedPlayer(c.name);
      await database().prepare("INSERT INTO audit_log (id,actor,action,created_at) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "Alpha", "Added approved player: " + player.name, Date.now()).run();
      return Response.json({ ok: true, player });
    }
    if (!ATTRIBUTES.includes(c.attribute) || c.value !== null && (!Number.isInteger(c.value) || c.value < 0 || c.value > 3)) throw new Error("Ratings must be 0, 1, 2, 3, or blank.");
    const ratings = await readRatings();
    if (c.revision !== ratings.revision) return Response.json({ error: "Ratings changed. Reload the committee room." }, { status: 409 });
    if (!ratings.players.some((p) => p.id === c.playerId)) throw new Error("Player not found.");
    ratings.data.overrides[`${c.playerId}:${a.committee}:${c.attribute}`] = c.value;
    const saved = await database().prepare("UPDATE private_ratings SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?").bind(JSON.stringify(ratings.data), "roster", c.revision).run();
    if (!saved.meta.changes) return Response.json({ error: "Another rating was saved. Reload first." }, { status: 409 });
    await database().prepare("INSERT INTO audit_log (id, actor, action, created_at) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), a.committee, "Updated player review", Date.now()).run();
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

// server/render/entry.ts
import { timingSafeEqual } from "node:crypto";
async function handleRoyalRangers(req) {
  const path = new URL(req.url).pathname.split("/").at(-1);
  if (path === "health") {
    try {
      const ready2 = await migrationStatus();
      return Response.json({ ok: ready2, service: "royal-rangers", storage: "postgres", release: process.env.RENDER_GIT_COMMIT || null, attendance: attendanceWorkerStatus }, { status: ready2 ? 200 : 503 });
    } catch {
      return Response.json({ error: "Storage unavailable" }, { status: 503 });
    }
  }
  if (path === "import") {
    const secret = process.env.RR_MIGRATION_TOKEN, actual = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!secret || !actual || actual.length !== secret.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(secret))) return Response.json({ error: "Not found" }, { status: 404 });
    if (req.method !== "POST") return new Response(null, { status: 405 });
    try {
      return Response.json({ counts: await importSnapshot(await req.json()) });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 409 });
    }
  }
  const route = { tournament: route_exports2, member: route_exports3, committee: route_exports4, push: route_exports }[path || ""];
  if (!route) return new Response(null, { status: 404 });
  const handler = route[req.method];
  if (!handler) return new Response(null, { status: 405 });
  if (!await migrationStatus()) return Response.json({ error: "Royal Rangers is moving to its new backend. Please retry shortly." }, { status: 503 });
  return handler(req);
}
export {
  handleRoyalRangers,
  startAttendanceReminders
};
