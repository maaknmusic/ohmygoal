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
