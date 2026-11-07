// Gifts and coin packs: the real prices. The browser shows the same table (js/stickers.js, js/premium-ish UI) but never decides a price:
// a test keeps the two lists equal, and everything that spends or sells coins reads THIS file.
export const GIFTS = Object.freeze({
    rose: 5, giftbox: 8, cake: 10, trophy: 15, rocket: 20, crown: 30, ring: 40, fireworks: 50,
});

/** Coin packs bought with money. Amounts are in paise (₹1 = 100), like the Premium plans. */
export const COIN_PACKS = Object.freeze({
    coins60: { coins: 60, amount: 4900, label: '60 coins' },
    coins200: { coins: 200, amount: 14900, label: '200 coins' },
    coins500: { coins: 500, amount: 34900, label: '500 coins' },
});

export const DAILY_COINS = 2;            // free coins once a day (Indian date)
export const DAILY_COINS_PREMIUM = 5;
export const GIFT_HOURLY_CAP = 30;       // gifts one account can send per hour
export const MAX_COINS = 100000;

// ---- Coins gifted from one person to another (functions/coingifts.js). Only coins that were BOUGHT can be gifted; the platform keeps
// COIN_GIFT_PLATFORM_PCT of the amount and the rest reaches the other person as coins they can spend (not cash out, not re-gift).
export const COIN_GIFT_MIN = 10;
export const COIN_GIFT_MAX = 500;            // per gift
export const COIN_GIFT_DAILY_CAP = 1000;     // coins one account can gift per Indian day
export const COIN_GIFT_PER_HOUR = 20;        // gifts one account can send per hour
export const COIN_GIFT_PLATFORM_PCT = 30;

const whole = v => (Number.isInteger(v) && v > 0 ? v : 0);

/** How a coin gift is shared: the platform keeps 30% (rounded up, so the recipient gets 70% rounded down) and no coin is lost or made. */
export function coinGiftSplit(amount) {
    const a = whole(amount);
    const recipient = Math.floor((a * (100 - COIN_GIFT_PLATFORM_PCT)) / 100);
    return { recipient, platform: a - recipient };
}

/**
 * A wallet after `n` coins are spent. Free coins (daily bonus, received gifts) are used up first, so the coins that were bought, which
 * are the only ones that can be gifted, last as long as possible: bought = min(bought, coins left).
 */
export function afterSpend(wallet, n) {
    const coins = whole(wallet?.coins);
    const left = Math.max(0, coins - whole(n));        // callers check the balance first; this just never goes below zero
    return { coins: left, bought: Math.min(Math.min(whole(wallet?.bought), coins), left) };
}
