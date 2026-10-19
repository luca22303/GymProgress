# GymProgress

A Push / Pull / Legs tracker for the iPhone, built as a web app you install to
the home screen. It shows what you did last time on every exercise and
suggests what to beat next, so progressive overload actually happens.

## Using it

- **Today** – pick Push, Pull or Legs (the next one in your rotation is marked
  *Up next*). Each muscle-group slot shows the exercise you used last time;
  type over the name to change it.
  - Grey numbers in the Reps / Weight boxes are last time's values. Type the
    reps to log a set; leave weight empty to mean "same weight as last time".
  - **→ Next** is worked out automatically: if every set reached the top of the
    slot's rep range, add the weight jump (2.5 kg by default); otherwise same
    weight, one more rep per set.
  - Boxes turn orange when you beat last time. The circle fills when every set
    has reps; tap it to fold the card.
  - The note you write is shown the next time you do that exercise.
- **☰ → Progress** – weight and estimated 1-rep max per exercise, session
  history (▲ = new best), and sets per muscle over the last 7 days.
- **☰ → Body** – daily bodyweight with a 7-day average; tap *+ Measurements*
  on measuring days.
- **☰ → Settings** – edit each day's slots and rep ranges, kg/lb, weight jump,
  and download/restore a backup file.

Rotation is Push → Pull → Legs → Rest. *Up next* follows your last logged
workout, so a missed gym day never skips a workout.

## Data

Everything is stored on the phone (browser `localStorage`) and saved on every
keystroke — there is no account and no sync. Add the app to the home screen:
on iPhone, Safari can clear data for websites you haven't visited in 7 days,
but home-screen apps are exempt. Use *Settings → Download backup* before
switching phones.

## Install on iPhone

1. Host it (see below) and open the URL in **Safari**.
2. Tap **Share** → **Add to Home Screen**.
3. Open it from the new icon — it runs full-screen and works offline.

## Hosting with GitHub Pages

Repository **Settings → Pages → Build and deployment**: Source *Deploy from a
branch*, pick the branch and `/ (root)`, Save. The app appears at
`https://<user>.github.io/GymProgress/` after a minute. (Pages on a private
repository needs a paid GitHub plan; otherwise make the repository public —
your workout data never goes there, it stays on your phone.)

## Development

Plain HTML/CSS/JS, no build step. Run `python3 -m http.server` in this folder
and open `http://localhost:8000`. Append `?date=2026-10-18` to pin "today" when
testing the rotation. `sw.js` caches the app for offline use — bump `CACHE`
when adding files.
