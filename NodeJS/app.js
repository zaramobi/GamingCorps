/**
 * app.js — Express application (no server.listen here so tests can import it cleanly).
 *
 * Balance update rule for POST /spin/:playerId
 * ─────────────────────────────────────────────
 *  spin value 1-3  → lose 50 EUR   (bad spin)
 *  spin value 4-6  → no change     (neutral spin)
 *  spin value 7-9  → win  50 EUR   (good spin)
 *  spin value 10   → win 200 EUR   (jackpot)
 *
 * Balance is floored at 0 — a player can never go negative.
 */

const express  = require("express");
const { getPlayer, updateBalance } = require("./store");
const { randomInt } = require("./random");


const app = express();
app.use(express.json());

// ── Helpers ──────────────────────────────────────────────────────────────────

function balanceDelta(spinValue) {
  if (spinValue <= 3)  return -50;
  if (spinValue <= 6)  return   0;
  if (spinValue <= 9)  return  50;
  return 200; // 10
}

function parseIntParam(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw Object.assign(new RangeError(`"${name}" must be an integer`), { status: 400 });
  }
  return n;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /balance/:playerId
app.get("/balance/:playerId", (req, res, next) => {
  try {
    const result = getPlayer(req.params.playerId);
    res.json(result);
  } catch (e) { next(e); }
});

// GET /random?min=1&max=10
app.get("/random", (req, res, next) => {
  try {
    const min = parseIntParam(req.query.min, "min");
    const max = parseIntParam(req.query.max, "max");
    const value = randomInt(min, max);
    res.json({ min, max, value });
  } catch (e) { next(e); }
});

// POST /spin/:playerId
app.post("/spin/:playerId", async (req, res, next) => {
  try {
    const { playerId } = req.params;

    // Reuse the same randomInt logic as GET /random
    const spinValue = randomInt(1, 10);
    const delta     = balanceDelta(spinValue);

    const result = await updateBalance(playerId, (current) =>
      Math.max(0, current + delta)
    );

    res.json({
      player:     result.playerId,
      spinValue,
      delta,
      outcome:    delta > 0 ? "win" : delta < 0 ? "lose" : "neutral",
      oldBalance: result.oldBalance,
      newBalance: result.newBalance,
    });
  } catch (e) { next(e); }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message });
});

module.exports = app;
