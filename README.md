# Pocket Option Telegram Bot

A Telegram-controlled **conditional order** bot for [Pocket Option](https://pocketoption.com) binary options.

You tell it a price. It keeps that instrument's live tick stream open, and the moment the market
touches your price it opens the trade for you and reports back: entry, win, loss, and the account
balance on every update.

Because these are binary options, there is **no stop loss and no take profit** anywhere in the
system. The only exit is the expiry the trade was opened with.

---

## What it does

**Per order you specify:**

| Field | Meaning |
| --- | --- |
| Symbol | e.g. `GBPAUD_otc`, `EURUSD` |
| Direction | buy (`call`) or sell (`put`) |
| Trigger price | the price the market has to reach |
| Entry mode | `touch`: enter on the very tick that hits the price<br>`next_candle`: the touch only arms the order; enter on the first tick of the next candle |
| Expiry mode | `fixed`: stay in for exactly N seconds<br>`floating`: ride to the close of the current candle (or the N-th candle) |
| Chart | timeframe (5s … 4h) and type (candle / heikin-ashi / line) |
| Amount | trade size in USD |
| Account | demo or real, these are physically different broker clusters |
| Validity | optional deadline after which an untriggered order is abandoned |

**Triggering is a crossing, not proximity.** When the order is created the bot samples the market and
records which side of the trigger it sat on. An order placed above the market only fires when the
price rises into it; one placed below only fires when the price falls into it. A tick that gaps
straight over the trigger still counts.

**One live session per watched instrument.** Each `(account, symbol)` pair that has an active order
gets its own authenticated socket to the broker, kept alive with the broker's own ping cadence and
re-subscribed automatically across reconnects. Sessions are reference-counted by the orders that need
them and torn down shortly after the last one settles.

**Everything survives a restart.** Orders live in SQLite and every state transition is written
through. On boot the engine re-attaches each pending, armed and open order. The one exception is an
order that was mid-flight when the process died: rather than risk a duplicate trade, it is flagged
for you to check on the broker.

---

## Quick start

```bash
bun install
cp .env.example .env      # then fill in the two required values
bun start
```

Minimum `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:AA...
TELEGRAM_ADMIN_IDS=              # leave empty; the first /start claims the bot
```

Then in Telegram: `/start`, and give the bot a broker session with `/session demo <SSID>`.

### راه‌اندازی سریع (فارسی)

۱. `bun install` را بزنید.
۲. فایل `.env.example` را به `.env` کپی کنید و `TELEGRAM_BOT_TOKEN` را بگذارید.
۳. `bun start` را اجرا کنید.
۴. در تلگرام `/start` بزنید، اولین چت مالک ربات می‌شود.
۵. با `/session demo <SSID>` نشست پاکت آپشن را ثبت کنید (راهنمای گرفتن SSID را با دستور `/session` ببینید).
۶. با `/new` سفارش بسازید یا از دستور تک‌خطی `/order` استفاده کنید.

---

## Getting your Pocket Option SSID

The bot authenticates over **socket.io** exactly as the web app does (it uses the `socket.io-client`
library against `wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket`), so it needs the
auth frame your browser sends.

1. Log into the account you want in a browser and open its trading screen:
   - demo: `https://p.finance/fa/cabinet/demo-quick-high-low/`
   - real: `https://p.finance/fa/cabinet/quick-high-low/`
2. Open DevTools (F12) → **Network** → filter **WS** → reload the page.
3. Click the connection whose URL looks like
   `demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket`
   (for a real account: `api-eu.po.market`).
4. Open the **Messages** tab. After the server's `40{"sid":"…"}` handshake you will see an outgoing
   frame starting with `42["auth",`.
5. Send that whole frame to the bot:

```
/session demo 42["auth",{"sessionToken":"…","uid":"…","lang":"fa","currentUrl":"cabinet/demo-quick-high-low","isChart":1}]
```

Both auth dialects are supported, and the bot recognises either success reply:

| Front-end | Auth frame key | Success reply |
| --- | --- | --- |
| p.finance (current) | `sessionToken` | `42["auth/success"]` |
| older / pocketoption.com | `session` | `successauth` |

The bot deletes the message carrying the SSID immediately, then tests the connection so you get a
straight yes/no rather than a silent failure.

> ⏳ **Sessions are short-lived.** Capture the frame from a tab that is logged in *right now*; a
> token copied days earlier is almost always dead. The two failure modes are distinguished for you:
> a `session` frame the broker rejects is dropped within milliseconds with `NotAuthorized`, while a
> stale `sessionToken` frame is silently ignored and is reported after the auth timeout. In both
> cases the bot stops reconnecting, tells you, and leaves your pending orders intact until you send
> a fresh SSID.

The SSID can also be pre-loaded from `.env` (`PO_DEMO_SSID` / `PO_REAL_SSID`); values set from
Telegram take precedence and persist in the database.

---

## Commands

| Command | Purpose |
| --- | --- |
| `/new` | Interactive order builder, every field on one inline keyboard |
| `/order …` | One-line order (see below) |
| `/list` | Active orders, with live price and a cancel button |
| `/cancel <id>` | Cancel a pending or armed order (an open trade cannot be cancelled) |
| `/history` | Recent orders |
| `/stats` | Wins / losses / net P&L over the last 24h |
| `/balance [demo\|real]` | Account balance |
| `/price <symbol>` | Live price |
| `/status` | Session health, endpoints, broker clock offset |
| `/mode demo\|real` | Default account |
| `/settings`, `/set <key> <value>` | Defaults for new orders |
| `/session demo\|real <SSID>` | Store and test broker credentials |
| `/id` | Your chat id |

### One-line order syntax

```
/order <symbol> <buy|sell> <price> [key=value …]
```

```
/order GBPAUD_otc buy 1.95320 tf=1m dur=60 amount=1 acc=demo
/order EURUSD sell 1.08540 tf=1m exp=float candles=1 entry=next
```

| Key | Values | Default |
| --- | --- | --- |
| `tf` | `5s`, `1m`, `5m`, `1h`, … | `/set tf` |
| `chart` | `candle`, `ha`, `line` | `/set chart` |
| `entry` | `touch`, `next` | `/set entry` |
| `exp` | `fixed`, `float` | `/set expiry` |
| `dur` | `60`, `1m`, `31s` (implies `exp=fixed`) | `/set dur` |
| `candles` | `1`, `2`, … (implies `exp=float`) | `/set candles` |
| `amount` | USD | `/set amount` |
| `acc` | `demo`, `real` | `/mode` |
| `valid` | `30m`, abandon if never triggered | none |

Persian direction words (`خرید` / `فروش`) and Persian digits are accepted.

---

## How expiry is computed

`fixed` maps to the broker's relative `time` field: *N seconds from the fill*.

`floating` needs the trade to land exactly on a candle close, so it uses the broker's absolute
`closeAt` field. That field is expressed in the **broker's** timezone, so the client starts from
`PO_SERVER_TIME_OFFSET` (default `7200`) and re-learns the true offset from the first order
acknowledgement, which keeps it correct across DST changes. If the broker still rejects the absolute
expiry, the engine retries the same trade with the equivalent relative duration.

If a floating order would expire within `MIN_DURATION_SECONDS` of the fill, it rolls forward to the
next candle instead of opening a trade that is over before it starts.

---

## Architecture

```
src/
  index.ts              wiring + graceful shutdown
  config.ts             env parsing and validation (zod)
  types.ts              domain vocabulary
  pocket/
    servers.ts          demo/real endpoint lists with failover
    protocol.ts         socket.io event names and defensive frame parsers
    client.ts           one authenticated connection: auth, keepalive, orders
    candles.ts          tick -> candle aggregation (candle / heikin-ashi / line)
  engine/
    trigger.ts          pure crossing detection
    session.ts          one session per (account, symbol) + reference counting
    engine.ts           the order state machine
  storage/
    db.ts               SQLite schema (bun:sqlite, WAL)
    orders.ts           order repository
    settings.ts         runtime settings, overriding env
  telegram/
    bot.ts              commands, access control, notifications
    wizard.ts           the /new order builder panel
    parse.ts            one-line /order syntax
    format.ts           all Persian user-facing copy
```

Order lifecycle:

```
pending ──price touches trigger──┬─ touch mode ──────────────► placing ─► open ─► won / lost / draw
                                 └─ next_candle ─► armed ─► (candle opens) ─► placing ─► open ─► …
```

`pending` also ends in `cancelled` (by you) or `expired` (validity elapsed); any step can end in
`failed` if the broker refuses the trade.

---

## Running with Docker

The image is Bun on Alpine, runs as a non-root user, and keeps a read only root
filesystem. Only `./data` is writable, which is where the SQLite database lives.

```bash
cp .env.example .env          # then fill in the token and the SSID
echo "DOCKER_UID=$(id -u)" >> .env
echo "DOCKER_GID=$(id -g)" >> .env
docker compose up -d
docker compose logs -f
```

The database is a bind mount, not a Docker volume: `./data` on the host is
mounted at `/app/data` in the container, so `data/bot.sqlite` stays in the
project directory where you can read, copy and back it up normally. Point
`DATA_DIR` in `.env` somewhere else if you want it in another path.

`DOCKER_UID` / `DOCKER_GID` must match the owner of `./data` on the host,
otherwise the container cannot write the database. The entrypoint checks this
before startup and tells you what to fix instead of failing later on a write.
The mount is declared with `create_host_path: false`, so a missing `./data`
stops compose with a clear message rather than creating a root owned directory.

The container writes a heartbeat file every 30 seconds and the healthcheck marks
it unhealthy once that file is older than two minutes, so a process that is
technically alive but no longer working shows up in `docker ps` as unhealthy.
With `restart: unless-stopped` the bot comes back after a crash or a reboot, and
pending orders are re-attached from SQLite on startup.

Useful commands:

```bash
docker compose ps                        # health status
docker compose restart bot               # after changing .env
docker compose up -d --build             # after changing the code
cp data/bot.sqlite backup-$(date +%F).sqlite   # back up orders and settings
```

Stopping is graceful: `docker compose stop` sends SIGTERM, the bot stops polling,
closes the broker sockets and the database, and exits within the 20 second grace
period. Open trades keep running at the broker and are reconciled on the next
start.

## Configuration

Everything is optional except `TELEGRAM_BOT_TOKEN`. See `.env.example` for the full list; the
notable ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_ADMIN_IDS` | *(empty)* | Allowed chat ids. Empty means the first `/start` claims the bot |
| `PO_DEMO_SSID` / `PO_REAL_SSID` | *(empty)* | Seed credentials; `/session` overrides and persists |
| `PO_DEMO_SERVERS` / `PO_REAL_SERVERS` | built-in list | `url` or `url|origin`, comma separated |
| `PO_SERVER_TIME_OFFSET` | `7200` | Starting guess for the broker clock offset |
| `MIN_DURATION_SECONDS` | `5` | Broker floor for a binary option |
| `SESSION_IDLE_TTL_SECONDS` | `60` | How long a session lingers after its last order settles |
| `DISPLAY_TIMEZONE` | `Asia/Tehran` | Timezone for every timestamp shown in Telegram |

## Development

```bash
bun run dev         # watch mode
bun test            # 79 tests, no network access required
bun run typecheck   # tsc --noEmit
```

The engine takes its `SessionManager` by injection, so the whole order state machine
(triggering, arming, expiry arithmetic, settlement) is tested against a fake broker with no
sockets involved. The Telegram layer is tested by feeding synthetic updates through grammY and
capturing the outgoing API calls.

## Notes and limits

- `old.js` is the original single-strategy prototype this project replaced. It is kept for
  reference only and is not used at runtime.
- Pocket Option publishes no API contract. Every frame parser here is defensive, and the client
  treats account-scoped data (a balance push) as proof of authentication so a renamed success event
  cannot strand it. A broker-side change can still break things; `/status` and the connection
  notifications exist to make that obvious quickly.
- The bot never cancels an open binary option, because the broker does not allow it.
- Trade at your own risk. Real-money mode does exactly what you tell it to.
