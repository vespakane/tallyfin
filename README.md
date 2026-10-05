# Amazon Seller – home screen clone

Pixel-measured clone of the Amazon Seller app home screen (UK marketplace) at iPhone 15/16 size
(393 x 852 pt, 3x). Every position, colour and font size was measured from the screenshots in
`screenshots/` and verified against them with a headless-browser overlay.

## Run

Serve the folder over HTTP (the fonts need a real origin):

    python3 -m http.server 8765

Then open http://localhost:8765 on your Mac, or http://<your-mac-ip>:8765 on your iPhone and add it
to the Home Screen for a full-screen version with the real status bar.

## How it works

- Opening the app shows the navy launch screen with the wordmark for about two seconds, then fades to the dashboard.
- On every launch a sheet asks for today's figures: total sales, order items, total balance and the
  feedback numbers. Optional fields: total sales for the last 7 days, last 30 days, this month, this
  year and last year, the Orders card counts, buyer messages, IPI, deal and voucher sales.
  Tap the "amazon seller" logo or the ⋮ on the Sales card to open it again.
- All figures are stored in the browser and drive every timeframe consistently: today's total is the
  last bar of 7D, WEEK, 30D and MONTH and part of this month's bar in YEAR; the 7-day total contains
  today; the 30-day total contains the 7 days, and so on. Periods you leave blank are estimated from
  the ones you entered.
- Sales are spread across hours, days and months with a human-looking pattern (night lull, morning
  ramp, evening peak, weekday/weekend and seasonal differences) plus seeded noise, so the shape is
  irregular but stable: re-entering a total only rescales that period, it never reshuffles the bars.
- Dates, axis labels and comparison labels ("yesterday", "last 7D", "last week", "last 30D", previous
  month name, previous year) are computed from the current date and time. Week, Month and Year are
  compared like for like: the period so far against the prior week up to the same weekday, the prior
  month up to the same day number and the prior year up to the same date.

## Daily backlog and simulation

- Every day you enter is stored by date. Open the sheet (logo or the Sales card's three dots), pick a
  day from the row of the last 14 days (an orange dot marks days you entered) or any earlier date with
  the date field, and enter or overwrite its figures. The sheet shows what the dashboard currently has
  for that day, simulated or not. Days already shown are never reshuffled.
- Every day has its own hourly shape rather than the same curve: the noise drifts over a few hours,
  and some days get a sell-out (sales drop to almost nothing, sometimes restocked a few hours later),
  a cheaper-at-night price (a late-evening peak), a rush, a lull, a burst of orders or dead hours.
  Sell-outs and night deals also lower or raise that day's simulated total.
- Pending orders on the Orders card are about 80% of today's order items plus 20% of yesterday's,
  unless you enter a number yourself.
- The ALL dropdown on the Orders card opens the **Simulation** switch. When it is on, each new day is
  generated from your recent level and trend with weekday and seasonal patterns, plus events:
  stock-outs (several days near zero, then a catch-up), supply hiccups, cash-flow squeezes,
  promotions and one-day dips. Today's figure grows through the day. Days that have passed are frozen
  into the backlog.
- The **balance** follows sales: each day's sales after fees (about 72%) are held until delivery
  (1–3 days) + 7 days, and whatever has unlocked is paid out daily, so the balance is the money still
  held from roughly the last 8–10 days. **Feedback** follows orders: a drifting share of about 0.75%
  leaves feedback a few days after ordering (mostly positive), counted over a rolling 30 days, and the
  average is worked out from those ratings. Each has a Simulated / Manual switch in the entry sheet;
  on Manual the card shows exactly what you typed.
- Days you don't enter are simulated. A figure entered for today is the total by the time you enter it:
  the entry time is stored, and the rest of the day keeps simulating on top of it (sales, orders, the
  hourly chart and the balance keep growing). The forecast for the remaining hours is pulled towards
  how the day was going when you entered it, more so the later in the day you entered it. Changing today's sales resets the entry
  time; saving it unchanged keeps the original time. Figures entered for past days count as full days.
- Switch it off to enter or overwrite days yourself; the entry sheet also opens on launch while it is
  off. Switch it back on and the simulation continues from what you entered (later simulated days are
  regenerated from the new trend).

## Query parameters (for testing)

- `?range=d7|week|d30|month|year` – open on that timeframe
- `?state=none` – don't open the entry sheet; `?state=setup` – open it immediately
- `?demo=1` – sample figures, nothing saved; `?demo=sim&ago=20` – as if entered 20 days ago and simulated since
- `?splash=0` – skip the launch screen (any number = how long it holds, in ms)

## Layout

- `index.html`, `css/styles.css`, `js/app.js` – the app
- `fonts/modern/` – Ember Modern Text and Ember Modern Display (Amazon's 2025 typefaces by NaN, the
  ones the app really uses; Regular and Bold, fetched from Amazon's own web CDN). The app's medium
  weight is not published, so "Your store is healthy", the tabs and "View reports" use Regular with a
  hairline stroke. `fonts/` also holds classic Amazon Ember (unused) and SF Pro for the status bar
  and tab bar.
- `assets/` – logo, flag, icons and status-bar glyphs cropped from the original screenshots
- `screenshots/` – the original screenshots
