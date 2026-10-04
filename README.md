# Wren Hollow Letter

A Vite + React toy: an old handwritten letter from a haunted house, found in a
dark room and seen through a camcorder viewfinder. The page uses a
pointer-following, rechargeable flashlight to read it, so don't let the battery
die.

## Prerequisites

- Node.js and npm

## Install and run

```bash
npm install
npm run dev
```

Vite prints the local development URL in the terminal. For a production-style
check, build and preview the app with:

```bash
npm run build
npm run preview
```

Run the linter with:

```bash
npm run lint
```

## Project structure

```text
src/
	App.jsx            Letter layout and spotlight interaction
	App.css            Aged paper, handwriting, and flashlight styling
	index.css          Global styles and font imports
	main.jsx           React entry point
	data/letter.json   The letter's text
```

The app is configured by [vite.config.js](vite.config.js), with scripts and
dependencies defined in [package.json](package.json).

## The letter

The letter's text lives in [src/data/letter.json](src/data/letter.json):
place, date, salutation, paragraphs, closing, signature, postscript, and the
messages carved into the desk.
Wrap a word in `~~double tildes~~` inside a paragraph to cross it out. The
postscript is rendered word by word with an increasingly unsteady hand.

## Rechargeable flashlight interaction

On a fine pointer, moving across the page aims a visible flashlight and its
spotlight. A full charge provides 30 seconds of active use. The bloom remains at
full size through 50% charge, then tapers gently while remaining useful until
the battery reaches 0%, when the flashlight stays off until shaken. Battery
drain pauses while the page is in a hidden tab and resumes when it becomes
visible. A visible page continues draining even when its browser window is not
focused.

Charging is shake-only and works at any battery level below 100%. Each
successful shake adds 20 percentage points, capped at 100%. On fine-pointer
devices, recharge requires five fast pointer direction reversals within 900 ms.
Touch devices use device motion and require four acceleration peaks within 900
ms. A 700 ms cooldown prevents one sequence from adding charge more than once.
There is no manual recharge control and no reveal bypass.

Below 20%, the beam begins a slight, intermittent dim flicker. Below 10%, it
instead includes brief true on/off flickers before turning off at 0%. Flicker
bursts use randomized strengths and timing, cap at 20 flickers per burst, and
add enough recovery time to respect the maximum transition cadence. Outside
brief low-battery outages, any positive charge retains a minimum energy of
0.28. Flicker is disabled for coarse-pointer and reduced-motion users.

The pointer position is the beam endpoint. The flashlight body is placed back
from that endpoint along the line toward the page center, using 24% of the page
width clamped to 150–280 px and a 42 px edge margin. The body rotates toward the
endpoint, and the visible beam starts at the lens, 48 px from the body's origin,
then extends exactly to the pointer endpoint.

On touch devices, the first touch may request permission to receive device-motion
events. Once permission is granted, shaking the device is the recharge path. If
motion permission is denied or device motion is unavailable, recharge can be
impossible on that device by design; the app does not provide a manual fallback.

## Things in the dark

The eyes only come while the light is out. A few seconds after the battery
hits 0%, a pair of glowing eyes fades in somewhere in the dark, away from the
letter, and keeps watching for as long as the light stays dead. Once you shake
the light back on they linger for 5–8 seconds and then slip away.

Hovering over the eyes (or tapping them on a touch screen) only does something
while the light has charge, so you have to recharge and catch them before they
go. Doing so glitches the camcorder: rolling tracking lines, a color-shifted jitter, and a jump in
exposure that lights the room. During each glitch the next message in
`carvings` (in [src/data/letter.json](src/data/letter.json)) is cut into the
desk beside the letter in pale, fresh wood; afterwards it stays in the dark
and can only be found with the flashlight. Long messages wrap onto short lines
to fit beside the letter; if there is no room there, they are cut wider and
nearly level above or below it. Carvings never overlap the letter or each
other. The eyes are gone
when the glitch clears. Glitches only ever happen this way. Each of the
first five times you catch them, another blood splatter, generated fresh each
visit and kept clear of the others, also lands on the letter and stays there,
with a few drips running down the page.

Eyes, and therefore glitches, are disabled for reduced-motion users. Their
timing lives in the `EYES_*` and `GLITCH_*` constants at the top of
[src/App.jsx](src/App.jsx).

## Customization

- Edit [src/data/letter.json](src/data/letter.json) to change the letter.
- Update copy and labels in [src/App.jsx](src/App.jsx).
- Adjust battery duration, warning thresholds, shake and motion sensitivity,
	flicker cadence, and feedback timing in the constants at the top of
	[src/App.jsx](src/App.jsx).
- Adjust the paper stains, folds, torn edges, ink color, layout breakpoints,
	spotlight size, and flashlight beam in [src/App.css](src/App.css).
- The handwriting is La Belle Aurore, the signature is Mrs Saint Delafield, and
	the camcorder overlay (REC, timecode, date, battery, and status messages) is
	VT323, all imported in [src/index.css](src/index.css) via `@fontsource`
	packages. The overlay's timecode only runs while the battery has charge.
