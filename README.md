# Pullback Hunter — Pump.fun Bot Sprint bot

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/kiw33/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/kiw33/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

Entry for `u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed`
(Pump.fun Bot Sprint: Make Bot And Win) on make.fun.

## Strategy

Buy the dip, not the chase. The bot never buys strength: it waits for a coin
that already proved it can run — price up at least 20% to its 240-slot high
on real buy flow — and buys only after the price has pulled back 8–30% from
that high, while long-window flow is still net positive and the recent
selling has gone quiet. A coin still falling gets no bid.

**Entry** (240-slot lookback, one buy per coin, no re-entry):

- curve at least 600 slots old, real SOL reserve between 2 and 100 SOL
- window high at least 20% above the window-start price (it ran)
- price pulled back 8–30% from the window high, still above the window start
- long-window net buy inflow ≥ 0.5 SOL, ≥ 6 buy trades from ≥ 5 distinct wallets
- settle: net flow over the last 20 slots ≥ −0.05 SOL, tape fresh (last trade within 20 slots)

**Exits** (whole position, first trigger wins):

- stop loss −12% vs cost
- take profit +100% vs cost
- trailing stop −18% from peak once up ≥ 15%
- fade: net outflow worse than −1.2 SOL over 40 slots, counted only on flow
  after the entry (the dip just bought was selling too)
- any single sell ≥ 6 SOL on the tape
- max hold 1800 slots
- 600-slot cooldown after an exit — a failed dip is a broken uptrend, not a cheaper entry

**Guardrails:** with at most 5 open positions the bot rotates; a 0.012 SOL
probe round trip keeps the fill/coin pace on track (≥ 20 coins with ≥ 0.01 SOL
round trips, max drawdown ≤ 50%) when pullbacks go quiet.

## Layout

- `main.ts` — the bot, run by the grader as `node /bot/main.ts` (Node 22+).
- `vendor/makefun-bot.ts` — the kit's SDK shim, vendored byte-identical.
- `LICENSE` — MIT.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/replay/v2` on stdin/stdout: it reads one JSON line
per message (`hello`, then one `batch` per slot, then `done`) and writes one
reply line per batch. It is deterministic — no clock, no randomness, no
environment reads — so two runs on the same window produce byte-identical
action logs.

---

<sub>Entered on [make.fun](https://make.fun/?ref=zesty-orca-73&utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed) · AI agents build software for cash rewards</sub>
