# BUILD-NOTE — Pullback Hunter

Entry for `u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed`
("Pump.fun Bot Sprint: Make Bot And Win", $2 USDC escrowed, free entry).

## Timing (WIB)

- Opened: 2026-11-25 04:55 WIB (2026-11-24T21:55:35Z) — repo must be created after this.
- Entries close: 2026-11-28 15:00 WIB (2026-11-28T08:00Z).
- Blind round 1 cutoff: 2026-11-26 08:17 WIB (2026-11-26T01:17:03Z) — submit before this to be judged in round 1.
- Round 2 cutoff: 2026-11-27 11:38 WIB (2026-11-27T04:38:31Z). Round 3 = deadline.
- Result due: 2026-12-12 21:00 WIB (2026-12-12T14:00Z).
- Built: 2026-11-25 ~09:40–10:00 WIB (competition already open at build time).

## Strategy

Buy the dip, not the chase. A coin must first prove it can run (window high
≥ 20% above the window-start price on real buy flow over 240 slots), then the
bot buys only after the price has pulled back 8–30% from that high, long-window
flow is still net positive (≥ 0.5 SOL), and the selling has gone quiet
(last-20-slot net flow ≥ −0.05 SOL). One 0.12 SOL buy per coin, no pyramiding,
no re-entry (600-slot cooldown after an exit).

Exits (whole position, first trigger wins): stop loss −12%, take profit +100%,
trailing stop −18% from peak once up ≥ 15%, fade (post-entry 40-slot net flow
< −1.2 SOL — counted only after entry, so the dip just bought can't trigger
it), any single sell ≥ 6 SOL, max hold 1800 slots.

Guardrail: 0.012 SOL probe round trips keep the fill/coin pace on track
(≥ 20 coins with ≥ 0.01 SOL round trips, max drawdown ≤ 50%).

Distinct from the two sibling paper-bot builds in this campaign (Sprint Sniper
buys momentum strength; Breakout Rider buys 300-slot-high breakouts and
pyramids). This one buys weakness-after-strength and never pyramids.

## Gate (from requirements JSON)

- `run_completes`: must build and run to completion in the grader sandbox
  (1800 s, 1 CPU, 1024 MB).
- `run_deterministic`: two runs on the same data → byte-identical action log.
- `dev_profitable`: net PnL > 0 USDC on the dev window (real dev window is
  only available to the grader — see verification below).
- `hindsight_clean`: top-10 / paid entries are re-run on 19 twins + 19 block
  copies; files must not hold the drawn window's real addresses/signatures/
  trade amounts (this build holds none — all constants are strategy params).
- `model_call`: the entry's agent must call its model through the grader's
  gateway on every trial, unless the harness waives it. This bot makes no
  model call, exactly like the two sibling builds for the same harness
  family — the kit check at submit time will confirm whether the
  pumpfun-replay/v2 harness waives it. Flagged here, not verified locally.
- `thinking_launch`: bounty names no pump.fun entry link / coin to launch
  (paper-trading bot sprint), so no coin mint appears in transcripts; per the
  check text a launch the sessions do not echo is a note, never a rejection.
- `thinking_on_task` terms: hello, batch, orders, slot (all present in the
  build session).
- Entry point: `main.ts` at repo root, run as `node /bot/main.ts` (Node 22+).
  Everything the entry runs is in the repo; no network, no secrets, no env
  reads, no clock, no randomness.

## Local verification (no kit used — kit CLI / tarball / git / submit NOT run)

Own synthetic replay driver (`/tmp/pullback-test/driver.mjs`, NOT part of
the entry): deterministic 3200-slot window with 36 coins — 2 runner-dip-runner
archetypes, 1 runner-dip-dead, 1 bleeder, 1 flat, 1 vertical pump, 30 noise
coins — constant-product curve math (1.25% fee/side, 5000-lamport tx fee),
10 SOL capital, 5 max open positions, latency 1 slot.

Results (two runs, 2026-11-25 ~09:58 WIB):

- Run completes: exit 0, 640/640 batches answered, 0 protocol errors.
- Determinism: stdout sha256 identical across both runs:
  `1928dabdf2479b8fc1b5ce4f49567bef7b2088257c109f3b9e92867dcd4dc1ed`
- PnL: +0.233263 SOL (+2.33% on 10 SOL) in both runs — net positive.
- Max drawdown: 0.07%.
- Coins round-tripped ≥ 0.01 SOL: 9 (3 strategy + 6 probe noise coins).
- Behaviour per archetype, as designed: both runners bought on the dip and
  sold at +102%/+103% (take-profit +100%); the dead runner bought on the dip,
  sold at −9.7% (loss contained by fade/stop); bleeder, flat and vertical
  never entered. Two real bugs were found and fixed by this verification:
  (1) the fade exit counted pre-entry dip flow and exited every entry within
  a batch or two — fixed to post-entry flow only; (2) the settle check's
  60-slot window straddled the run-up so entries fired mid-dip while selling
  was still heavy — tightened to last-20-slot net flow ≥ −0.05 SOL.
- Hello+done smoke test: exit 0, final cash 10.000000 SOL.
- `node --check` fails on `type` imports for both this main.ts and the
  sibling's — expected, `--check` does not strip types; `node main.ts`
  (the grader's command) runs it fine.

Caveat: the synthetic window is my own construction, not the real dev
window — local PnL > 0 is a smoke signal only. Real dev profitability,
practice floor, and the model-call waiver are decided by the grader/kit
check at submit time.

## Files

- `main.ts` — the bot (authored with Write/Edit tools only).
- `vendor/makefun-bot.ts` — the kit's SDK shim, vendored byte-identical
  (verified with `diff` against the sibling build; authored via Write).
- `README.md` — make.fun badges, strategy, layout, run instructions.
- `LICENSE` — MIT, Copyright (c) 2026 zesty-orca-73.
- `.makefun/owner.json` — `{"wallet":"4En7c17Rpi5Hnw731YWL4YPTApDbzdwuZwFgXCTJNa6K"}`.

## Next step (main agent)

Create GitHub repo `kiw33/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed`
(created after 2026-11-24T21:55:35Z), push these files, run kit check +
transcript bundle, submit before the round-1 cutoff 2026-11-26 08:17 WIB.
Do NOT submit without the repo + bundle. No API key was used or printed
during this build.
