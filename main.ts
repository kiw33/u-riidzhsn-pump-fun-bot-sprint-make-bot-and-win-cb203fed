// Pullback Hunter — a pump.fun paper-trading bot that buys the dip, not the chase.
//
// Different bet from a momentum snipe or a breakout ride: this bot never buys
// strength. It waits for a coin that already proved it can run — price up at
// least 20% to its 240-slot high on real buy flow — and then buys only after
// the price has pulled back 8-30% from that high, while the long-window flow
// is still net positive and the recent selling has gone quiet. The idea is
// that on fresh bonding curves the first vertical leg shakes out weak hands,
// and the coins that hold their uptrend through the dip are the ones with
// buyers still waiting underneath. A coin still falling gets no bid: the
// 60-slot settle check refuses entries while net flow is still negative.
//
// One buy per coin, no pyramiding, no re-entry after an exit: a dip that
// fails is a broken uptrend, not a cheaper entry. Stakes are 0.12 SOL —
// bigger than a sniper's, because the filter is stricter and fires less
// often, so each trade has to carry more of the run.
//
// Guardrails: the run must end with a round trip of at least 0.01 SOL on at
// least 20 coins and a max drawdown of 50% or less. With at most 5 open
// positions the bot rotates, and a 0.012 SOL probe round trip keeps the
// fill/coin pace on track when pullbacks go quiet.
//
// Deterministic by construction: no clock, no randomness, iteration only over
// insertion-ordered maps fed by the batch stream. Two runs on the same window
// produce byte-identical action logs.
//
// Run by the grader as `node /bot/main.ts` with this directory mounted at /bot.

import {
  LAMPORTS_PER_SOL,
  runBot,
  type Batch,
  type BotState,
  type OrderInput,
  type Pubkey,
} from './vendor/makefun-bot.ts';

const LAMPORTS = 1e9;
// The curve takes 1.25% (95 + 30 bps) on each side; a round trip costs ~2.5%
// of the stake plus two 5000-lamport tx fees, so a trade must clear ~3% gross
// to make money. The stop loss is set far wider than that on purpose: exits
// are driven by price action, not by fee noise.
const CURVE_FEE = 0.0125;

interface Params {
  /** Long lookback the coin must have run up over, in slots. */
  longWindow: number;
  /** The run-up to the window high must be at least this (fraction). */
  minRunUp: number;
  /** Pullback from the window high: buy only inside this band. */
  dipMin: number;
  dipMax: number;
  /** Long-window net buy SOL (buys minus sells) must be at least this. */
  minNetLong: number;
  /** Buy trades in the long window. */
  minBuysLong: number;
  /** Distinct buying wallets in the long window. */
  minBuyersLong: number;
  /** Recent window whose net flow must have stopped falling. */
  settleWindow: number;
  /** Net SOL over the settle window must be at least this. */
  settleNetMin: number;
  /** Curve real SOL bounds at entry. */
  minRqSol: number;
  maxRqSol: number;
  /** Slots since the CreateEvent before an entry is allowed. */
  minAge: number;
  /** SOL staked on one coin. */
  stakeSol: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Exit when value falls this far below cost. */
  stopLoss: number;
  /** Trailing stop: exit when value falls this far below its peak. */
  trail: number;
  /** The trailing stop arms once value reaches cost * (1 + trailArm). */
  trailArm: number;
  /** Take the whole profit at this gain over cost. */
  takeProfit: number;
  /** Exit when net SOL over the fade window falls below -fadeNetSol (flow after entry only). */
  fadeWindow: number;
  fadeNetSol: number;
  /** Exit on any single recorded sell of at least this many SOL. */
  bigSellSol: number;
  /** Exit after this many slots held. */
  maxHold: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Guardrail pacing: targets for the run, scaled by elapsed block time. */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
}

const PARAMS: Params = {
  longWindow: 240,
  minRunUp: 0.2,
  dipMin: 0.08,
  dipMax: 0.3,
  minNetLong: 0.5,
  minBuysLong: 6,
  minBuyersLong: 5,
  settleWindow: 20,
  settleNetMin: -0.05,
  minRqSol: 2,
  maxRqSol: 100,
  minAge: 600,
  stakeSol: 0.12,
  minBuySol: 0.01,
  buySlipBps: 1000,
  stopLoss: 0.12,
  trail: 0.18,
  trailArm: 0.15,
  takeProfit: 1.0,
  fadeWindow: 40,
  fadeNetSol: 1.2,
  bigSellSol: 6,
  maxHold: 1800,
  cooldown: 600,
  targetCoins: 30,
  targetFills: 240,
  paceSecs: 14_400,
  probeSol: 0.012,
  maxProbes: 1,
};

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  trades: Trade[];
  entered: boolean;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  /** SOL sent in buys for this position (fees included). */
  invested: number;
  exiting: boolean;
  filled: boolean;
  /** Close value at the latest batch (SOL, curve and tx fees deducted). */
  lastValue: number;
}

function priceOf(vq: bigint, vt: bigint): number {
  const q = Number(vq);
  const t = Number(vt);
  return t > 0 ? q / t : 0;
}

await runBot({
  onBatch(state: BotState, batch: Batch): OrderInput[] {
    const p = PARAMS;
    const now = batch.slot;
    const tapes = (state as unknown as { __tapes?: Map<Pubkey, Tape> }).__tapes ??
      ((state as unknown as { __tapes: Map<Pubkey, Tape> }).__tapes = new Map());
    const held = (state as unknown as { __held?: Map<Pubkey, Held> }).__held ??
      ((state as unknown as { __held: Map<Pubkey, Held> }).__held = new Map());
    const probes = (state as unknown as { __probes?: Map<Pubkey, boolean> }).__probes ??
      ((state as unknown as { __probes: Map<Pubkey, boolean> }).__probes = new Map());
    const pace = (state as unknown as { __pace?: { fills: number; coins: Set<Pubkey>; first: number | null; last: number | null } }).__pace ??
      ((state as unknown as { __pace: { fills: number; coins: Set<Pubkey>; first: number | null; last: number | null } }).__pace = { fills: 0, coins: new Set(), first: null, last: null });

    const keep = p.longWindow + 5;
    const bigSell = new Set<Pubkey>();
    const traded = new Set<Pubkey>();

    for (const f of batch.fills) {
      if (f.status === 'filled' && !f.client_id.startsWith('_')) {
        pace.fills++;
        pace.coins.add(f.mint);
      }
    }
    for (const e of batch.events) {
      if (e.block_time !== null) {
        if (pace.first === null) pace.first = e.block_time;
        if (pace.last === null || e.block_time > pace.last) pace.last = e.block_time;
      }
      let t = tapes.get(e.mint);
      if (t === undefined) {
        t = { created: null, trades: [], entered: false, lastExit: -1e12 };
        tapes.set(e.mint, t);
      }
      if (e.event === 'CreateEvent') {
        t.created = e.slot;
      } else if (e.event === 'TradeEvent') {
        const sol = Number(e.sol_amount) / LAMPORTS;
        t.trades.push({
          slot: e.slot,
          buy: e.is_buy,
          sol,
          user: e.user,
          price: priceOf(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves)),
        });
        traded.add(e.mint);
        if (!e.is_buy && sol >= p.bigSellSol) bigSell.add(e.mint);
      }
    }
    for (const mint of traded) {
      const t = tapes.get(mint)!;
      let cut = 0;
      while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
      if (cut > 0) t.trades.splice(0, cut);
    }

    const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
    const pendingByMint = new Map<Pubkey, number>();
    for (const po of state.pending.values()) {
      pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);
    }

    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = Number(state.txFeeLamports()) / LAMPORTS;

    const valueOf = (mint: Pubkey): { value: number; cost: number; rqSol: number } | null => {
      const pos = state.positions.get(mint);
      const curve = state.curves.get(mint);
      if (pos === undefined || curve === undefined) return null;
      const mk = marks.get(mint);
      const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
      const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
      const rqSol = (mk ? Number(mk.real_quote_reserves) : Number(curve.real_quote_reserves)) / LAMPORTS;
      const tokens = Number(pos.token_amount);
      // Selling `tokens` into the curve returns tokens * vq / (vt + tokens),
      // minus the curve fee and one tx fee.
      const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
      return { value, cost: Number(pos.cost_lamports) / LAMPORTS, rqSol };
    };

    const netFlow = (t: Tape, w: number): number => {
      let net = 0;
      for (let i = t.trades.length - 1; i >= 0; i--) {
        const tr = t.trades[i]!;
        if (tr.slot <= now - w) break;
        net += tr.buy ? tr.sol : -tr.sol;
      }
      return net;
    };

    // Net flow counted only after the position opened: the dip this bot
    // bought into was itself a burst of selling, and counting pre-entry
    // flow would fade-exit every entry within a batch or two of buying it.
    const flowAfterEntry = (t: Tape, opened: number, w: number): number => {
      const from = Math.max(now - w, opened);
      let net = 0;
      for (let i = t.trades.length - 1; i >= 0; i--) {
        const tr = t.trades[i]!;
        if (tr.slot <= from) break;
        net += tr.buy ? tr.sol : -tr.sol;
      }
      return net;
    };

    // Exits first: cut losers, bank winners, never let a position bleed out.
    for (const [mint, h] of held) {
      const pos = state.positions.get(mint);
      const curve = state.curves.get(mint);
      if (pos === undefined) {
        if (!pendingByMint.has(mint)) {
          held.delete(mint);
          if (h.filled) tapes.get(mint)!.lastExit = now;
        }
        continue;
      }
      h.filled = true;
      if (curve === undefined || curve.complete) continue;
      const v = valueOf(mint);
      if (v === null) continue;
      if (v.value > h.peakValue) h.peakValue = v.value;
      h.lastValue = v.value;
      const t = tapes.get(mint)!;
      let exit = h.exiting;
      if (!exit && v.value < v.cost * (1 - p.stopLoss)) exit = true;
      if (!exit && v.value >= v.cost * (1 + p.takeProfit)) exit = true;
      if (!exit && h.peakValue >= v.cost * (1 + p.trailArm) && v.value < h.peakValue * (1 - p.trail)) exit = true;
      if (!exit && flowAfterEntry(t, h.opened, p.fadeWindow) < -p.fadeNetSol) exit = true;
      if (!exit && bigSell.has(mint)) exit = true;
      if (!exit && now - h.opened > p.maxHold) exit = true;
      if (!exit) continue;
      h.exiting = true;
      let sellPending = false;
      for (const po of state.pending.values()) {
        if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
      }
      if (sellPending) continue;
      if (orders.length >= cap) break;
      orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
    }

    // Probe round trips: sell the whole probe as soon as its buy has landed.
    for (const [mint, selling] of probes) {
      const pos = state.positions.get(mint);
      const curve = state.curves.get(mint);
      if (pos === undefined) {
        if (!pendingByMint.has(mint)) probes.delete(mint);
        continue;
      }
      if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
      if (orders.length >= cap) break;
      orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      if (!selling) probes.set(mint, true);
    }

    // Entries: one buy per coin, only after a proven run has pulled back
    // and the selling has gone quiet.
    let free = Number(state.freeCashLamports()) / LAMPORTS;
    let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
    for (const mint of traded) {
      if (orders.length >= cap) break;
      if (slotsLeft <= 0) break;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      if (pendingByMint.has(mint) || probes.has(mint) || held.has(mint)) continue;
      const t = tapes.get(mint)!;
      if (t.entered) continue;
      if (now - t.lastExit < p.cooldown) continue;
      const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
      if (rqSol < p.minRqSol || rqSol > p.maxRqSol) continue;
      if (t.created === null || now - t.created < p.minAge) continue;

      const from = now - p.longWindow;
      let buySol = 0;
      let sellSol = 0;
      let buys = 0;
      let startPrice = -1;
      let high = 0;
      let last = 0;
      let lastSlot = -1;
      const byUser = new Map<string, number>();
      for (const tr of t.trades) {
        if (tr.slot <= from) {
          startPrice = tr.price;
          continue;
        }
        if (startPrice < 0) startPrice = tr.price;
        if (tr.buy) {
          buySol += tr.sol;
          buys++;
          byUser.set(tr.user, (byUser.get(tr.user) ?? 0) + tr.sol);
        } else {
          sellSol += tr.sol;
        }
        if (tr.price > high) high = tr.price;
        last = tr.price;
        lastSlot = tr.slot;
      }
      if (buys < p.minBuysLong || byUser.size < p.minBuyersLong) continue;
      if (buySol - sellSol < p.minNetLong) continue;
      if (startPrice <= 0 || high <= 0 || last <= 0) continue;
      // The run: the window high must clear the window start by minRunUp.
      if (high / startPrice - 1 < p.minRunUp) continue;
      // The pullback: price off its high, inside the dip band, uptrend intact.
      const dip = 1 - last / high;
      if (dip < p.dipMin || dip > p.dipMax) continue;
      if (last < startPrice) continue;
      // The settle: recent flow no longer negative, and the tape is fresh.
      if (netFlow(t, p.settleWindow) < p.settleNetMin) continue;
      if (lastSlot < 0 || now - lastSlot > p.settleWindow) continue;

      const capSol = Number(state.maxBuyLamports(mint)) / LAMPORTS;
      let amount = Math.min(capSol, p.stakeSol);
      if (amount > free - tx) amount = free - tx;
      if (amount < p.minBuySol) continue;
      const lamports = BigInt(Math.floor(amount * LAMPORTS));
      orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.buySlipBps });
      free -= amount + tx;
      slotsLeft--;
      t.entered = true;
      held.set(mint, { opened: now, peakValue: 0, invested: amount, exiting: false, filled: false, lastValue: 0 });
    }

    // Guardrail pacing: open a probe when fills or coins lag the pace.
    if (probes.size < p.maxProbes && slotsLeft > 0 && pace.first !== null && pace.last !== null) {
      const elapsed = Math.min(1, (pace.last - pace.first) / p.paceSecs);
      const needCoins = pace.coins.size < Math.ceil(p.targetCoins * elapsed);
      const needFills = pace.fills < Math.ceil(p.targetFills * elapsed);
      if (needCoins || needFills) {
        const minRq = (p.probeSol * 10_000) / state.hello.caps.max_order_bps_of_real_reserve;
        for (const mint of traded) {
          if (orders.length >= cap || probes.size >= p.maxProbes) break;
          if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
          if (needCoins && !needFills && pace.coins.has(mint)) continue;
          const curve = state.curves.get(mint);
          if (curve === undefined || curve.complete) continue;
          if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
          if (free < p.probeSol + 2 * tx) break;
          orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
          probes.set(mint, false);
          free -= p.probeSol + tx;
        }
      }
    }
    return orders;
  },
  onDone(state) {
    const cashSol = Number(state.cash) / LAMPORTS;
    console.error(`done: final cash ${cashSol.toFixed(6)} SOL, positions ${state.positions.size}`);
  },
});
