/**
 * store.js — File-based persistent store with advisory file locking.
 *
 * Layout of data.json:
 *   { "players": { "A": { "balance": 500 }, "B": { "balance": 600 } } }
 *
 * Concurrency strategy (single-instance):
 *   A module-level promise chain (writeQueue) serialises every read-modify-write
 *   so concurrent requests within one process never interleave.
 *
 * Concurrency strategy (multi-instance, see DESIGN.md §E):
 *   Replace writeQueue with a distributed lock (Redis Redlock) and keep the
 *   same atomic read → mutate → write contract inside the lock.
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");

const INITIAL_STATE = {
  players: {
    A: { balance: 500 },
    B: { balance: 600 },
  },
};

// ── Bootstrap ────────────────────────────────────────────────────────────────

function initStore() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(INITIAL_STATE, null, 2), "utf8");
  }
}

function readStore() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeStore(data) {
  // Write to a temp file first, then rename — atomic on POSIX, best-effort on Windows.
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

// ── Serialised write queue ────────────────────────────────────────────────────
// All mutations are chained onto this promise so they never overlap within one
// Node.js process (the event loop is single-threaded; this covers async gaps).

let writeQueue = Promise.resolve();

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    writeQueue = writeQueue.then(() => {
      try { resolve(fn()); }
      catch (e) { reject(e); }
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

function getPlayer(playerId) {
  const data = readStore();
  const player = data.players[playerId];
  if (!player) throw Object.assign(new Error(`Player "${playerId}" not found`), { status: 404 });
  return { playerId, balance: player.balance };
}

/**
 * Atomically read the player's balance, apply updateFn, persist, return result.
 * updateFn receives the current balance and must return the new balance.
 */
function updateBalance(playerId, updateFn) {
  return enqueue(() => {
    const data = readStore();
    const player = data.players[playerId];
    if (!player) throw Object.assign(new Error(`Player "${playerId}" not found`), { status: 404 });

    const oldBalance = player.balance;
    const newBalance = updateFn(oldBalance);
    player.balance   = newBalance;

    writeStore(data);
    return { playerId, oldBalance, newBalance };
  });
}

module.exports = { initStore, getPlayer, updateBalance };
