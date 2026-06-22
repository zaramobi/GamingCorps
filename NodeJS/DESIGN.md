# Design document

## A. High-level design

```
Client
  │
  ▼
Express HTTP Server (app.js / server.js)
  │
  ├── GET  /balance/:playerId  ──▶  store.getPlayer()
  ├── GET  /random             ──▶  random.randomInt()
  └── POST /spin/:playerId     ──▶  random.randomInt()
                                    store.updateBalance()
                                          │
                                          ▼
                                    data.json  (persisted to disk)
```

## B. Data structure design

```json
{
  "players": {
    "A": { "balance": 500 },
    "B": { "balance": 600 }
  }
}
```

Plain JSON file (`data.json`) in the project directory.  
Why JSON over a binary format: human-readable for debugging, zero external
dependencies, trivially bootstrapped on first run.  
Why a flat key-value map (not an array): O(1) lookup by player ID.

## C. Balance update rule (POST /spin)

| spin value | outcome | delta   |
|------------|---------|---------|
| 1 – 3      | lose    | −50 EUR |
| 4 – 6      | neutral |   0 EUR |
| 7 – 9      | win     | +50 EUR |
| 10         | jackpot | +200 EUR|

Balance is always floored at 0 (cannot go negative).

## D. Example requests and responses

```
GET /balance/A
→ 200  { "playerId": "A", "balance": 500 }

GET /balance/Z
→ 404  { "error": "Player \"Z\" not found" }

GET /random?min=1&max=10
→ 200  { "min": 1, "max": 10, "value": 7 }

GET /random?min=10&max=1
→ 400  { "error": "min must be <= max" }

POST /spin/A
→ 200  {
         "player": "A",
         "spinValue": 8,
         "delta": 50,
         "outcome": "win",
         "oldBalance": 500,
         "newBalance": 550
       }
```

## E. Concurrency analysis

### The naive problem (4 instances, no locking)

```
Time  Instance 1              Instance 2
 0    read balance = 500
 1                            read balance = 500
 2    spin → +50, write 550
 3                            spin → +50, write 550   ← lost update!
```

Both instances read the same stale value; the second write overwrites the
first.  Net result: only one spin is accounted for.

### Race conditions

1. **Read-modify-write race** — two processes read before either writes.
2. **Partial write** — a crash mid-write leaves a corrupt file.
3. **Stale read cache** — an in-process cache holds a value invalidated by
   another instance.

### Approach comparison

| Approach                | Correctness | Latency | Complexity | Works across instances? |
|-------------------------|-------------|---------|------------|-------------------------|
| In-memory lock (queue)  | ✓ (1 inst)  | low     | low        | ✗                       |
| File lock (flock/proper)| ✓           | medium  | medium     | ✓ (same host only)      |
| Redis Redlock           | ✓           | medium  | medium     | ✓                       |
| Optimistic locking (CAS)| ✓           | low*    | medium     | ✓                       |
| DB transaction          | ✓           | medium  | low†       | ✓                       |
| Event sourcing          | ✓           | low*    | high       | ✓                       |

*low latency on low contention; retries add latency under high contention.
†low complexity because the DB handles it.

### Chosen approach in production

**PostgreSQL (or any ACID DB) with a `SELECT … FOR UPDATE` row lock.**

Rationale:
- Correct by construction — the DB enforces serialisation.
- No external lock daemon to operate.
- Survives instance restarts, network partitions (with replica lag tolerance).
- Auditable: every spin can be a row in a `spins` table (event log for free).
- Scales horizontally via connection pooling (PgBouncer).

Redis Redlock is a strong second choice if a DB is already ruled out, but it
adds a dependency and requires at least 3 Redis nodes for correctness.

## F. Production-grade architecture proposal

```
┌─────────────────────────────────────────┐
│            Load balancer (L7)           │
└────────┬────────┬────────┬──────────────┘
         │        │        │
    ┌────▼──┐ ┌───▼───┐ ┌──▼────┐   (N Express instances)
    │ App 1 │ │ App 2 │ │ App N │
    └────┬──┘ └───┬───┘ └──┬────┘
         └────────┼─────────┘
                  │
         ┌────────▼────────┐
         │  PostgreSQL      │  (primary + read replica)
         │  spins table     │
         │  players table   │
         └─────────────────┘
```

- Each spin inserts a row into `spins` and updates `players.balance` in one
  transaction with `SELECT … FOR UPDATE` on the player row.
- Read replicas serve `/balance` reads (eventual consistency acceptable; use
  primary if you need strict reads).
- PgBouncer pools connections.
- Prometheus + Grafana for observability.
- Rate limiting (nginx / API Gateway) per player ID to prevent abuse.

## G. Limitations and improvements

| # | Limitation | Impact | Improvement |
|---|-----------|--------|-------------|
| 1 | **File-based persistence** — no ACID, no concurrent-safe multi-file ops | Data loss on crash mid-write; wrong balances across instances | Replace with PostgreSQL + transactions |
| 2 | **In-memory write queue** — only works in a single process | Useless behind a load balancer | Distributed lock (Redis Redlock) or DB transaction |
| 3 | **No input validation for playerId** | Attackers can probe arbitrary keys or inject path traversal | Allowlist of valid IDs; middleware validation |
| 4 | **Math.random() fallback** — not cryptographically secure | Predictable outcomes in a gambling scenario | Enforce `crypto.randomInt` only; remove fallback |
| 5 | **No authentication / authorisation** | Anyone can spin for any player | JWT or session tokens; authorise `playerId` against the caller |
| 6 | **No rate limiting** | A client can drain a player's balance in milliseconds | Per-IP and per-player rate limits (express-rate-limit + Redis) |
| 7 | **Single data file** — single point of failure | One corrupted file = all player data gone | DB with WAL + backups; or at minimum, rolling backup of `data.json` |
| 8 | **No audit trail** | Cannot reconstruct what happened after a bug | Append-only `spins` log (event sourcing or a DB table) |
| 9 | **No monitoring** | Silent failures go undetected | Prometheus metrics endpoint (`/metrics`), structured JSON logging |
| 10 | **Balance can reach 0 permanently** | Player is stuck | Add a "top-up" endpoint or a minimum balance rule |
| 11 | **No idempotency key on /spin** | Network retry = double spin | Accept `Idempotency-Key` header; store result keyed by it |
| 12 | **Synchronous file I/O** | Blocks the event loop under load | Use `fs.promises` (async) or switch to a DB |
| 13 | **No schema validation** | Corrupt `data.json` crashes the process | Validate on read with a JSON Schema or Zod |
| 14 | **Flat file doesn't scale to many players** | O(n) scan to find a player once the map is serialised and re-parsed | DB with indexed rows |
| 15 | **No HTTPS** | Traffic is in plain text | Terminate TLS at the load balancer or add `helmet` + HTTPS in Express |

## H. Complexity analysis

| Operation | Time | Space |
|-----------|------|-------|
| GET /balance | O(1) parse + O(1) lookup | O(P) where P = number of players |
| GET /random | O(1) | O(1) |
| POST /spin | O(1) + file write | O(P) |
| write queue (N concurrent spins) | O(N) serialised | O(N) pending promises |

The bottleneck is the synchronous file write: ~1–5 ms on SSD.  
With 4 instances and the file on a shared network drive (NFS), latency spikes
to tens of ms and correctness is not guaranteed without proper file locking.

## I. Unit and integration testing strategy

See `app.test.js` for the runnable implementation.

### Unit tests
- `randomInt`: bounds, min === max, min > max throws, non-integer throws.
- `balanceDelta`: each spin bucket maps to the correct delta.
- `store.getPlayer`: unknown ID throws 404-tagged error.
- `store.updateBalance`: delta applied, floor at 0 respected.

### Integration tests (HTTP)
- `GET /balance/:playerId` — happy path, unknown player.
- `GET /random` — in-range value, min > max 400, non-integer 400.
- `POST /spin/:playerId` — shape of response, oldBalance/newBalance, unknown player.
- Balance floor: player with 10 EUR survives 20 losing spins without going negative.

### Concurrency test
- Fire 20 simultaneous `POST /spin/A` calls.
- Assert all return 200.
- Assert the sequence of `oldBalance → newBalance` transitions is strictly serial
  (no two spins share the same `oldBalance`).

### What is NOT tested
- Multi-process / multi-instance correctness (needs Docker Compose or a real
  distributed test harness).
- Persistence across restart (needs process spawn + file read after kill).
- Rate limiting (needs a rate-limit middleware first).
