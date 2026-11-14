# Actions: your own animations

An action is an animation you trigger on demand. You can play it from the **Actions** tab (▶ Test), with a global hotkey, or from Streamer.bot. EASY-TUBER ships with no actions. Each one you add is a single file.

## Adding one

1. In the **Actions** tab, click **Open actions folder**.
2. Put the action's file there, named `<id>.js` (the id is letters, digits, `-` or `_`, up to 40 characters).
3. Click **Reload actions**. The action shows up in the Actions tab, and the stage window and OBS load it too.

There is nothing else to edit. To remove an action, delete its file and reload.

If a file has a mistake in it, it is skipped, and the Actions tab says which file and why. The other actions still load.

Only add action files you trust. An action is a small program that runs inside EASY-TUBER.

### Where the files live

| | Folder | In the file, pictures and sounds are at |
|---|---|---|
| **Your actions folder** (the downloaded app, or from source) | Windows: `%APPDATA%\EASY-TUBER\actions` · Mac: `~/Library/Application Support/EASY-TUBER/actions` | `user-actions/<id>/…` |
| **Built into the app** (working from source) | `js/actions/` in this repository | `media/actions/<id>/…` |

Both are loaded when a page starts: `js/actions/` first, then your actions folder. If both have a file with the same id, yours is used.

## The file

```js
PT.Actions.define({
  id: 'wave',               // the same as the file name: wave.js
  label: 'Wave',            // shown in the Actions tab and the Streamer.bot list
  duration: 1800,           // ms, 100 to 60000. Sequences wait this long before the next step.
  overlap: false,           // true: playing it again while it runs adds a second copy instead of restarting
  // hold: true,            // instead of a duration: stays on until it is turned off (see Held actions)

  // optional: sliders and checkboxes in the Actions tab, saved with the project, read as a.settings.<key>
  settings: [
    { key: 'height', label: 'Height', type: 'range', min: 0, max: 100, step: 1, default: 60, suffix: '%' },
    { key: 'both', label: 'Both arms', type: 'check', default: false },
  ],

  // every hook below is optional
  start(a) {},              // once, when it starts (a.state is yours to keep things in)
  pose(a) { return { armRUpper: { rot: -120 * a.envelope() } }; },
  states(a) { return { mouth: 'open' }; },
  parts(a, partId) { return null; },
  behind(a, g) {},
  front(a, g) {},
  end(a) {},                // once, when it finishes or is replaced
});
```

### What each hook gets: `a`

| | |
|---|---|
| `a.t` | progress 0 → 1 over `duration` |
| `a.ms`, `a.duration` | elapsed and total time, ms |
| `a.envelope(inMs = 150, outMs = 250)` | 0 → 1 at the start, 1 → 0 at the end. Multiply motion by it so the action blends in and out instead of snapping. |
| `a.between(from, to)` | progress through one slice of the run, for example `a.between(0.2, 0.6)` |
| `a.ease` | `linear inQuad outQuad inOut outBack outElastic bell` (each takes 0..1) |
| `a.random()` | seeded random number 0..1. It gives the same numbers in the editor, the stage window and OBS. Use it instead of `Math.random()`. |
| `a.settings` | this action's settings, with defaults filled in |
| `a.state` | an empty object for this run, to keep things between frames |
| `a.args` | the values this play came with, from the Streamer.bot URL: `…?action=wave&user=Bob&amount=500` gives `a.args.user === 'Bob'` and `a.args.amount === '500'`. Every value is text, so use `Number(a.args.amount)` for a number. It is an empty object when there are none (Test, a hotkey), so give each value a fallback: `a.args.user \|\| 'someone'`. |
| `a.at(partId, u, v)` | where a point on a part is right now, in stage units. `u, v` are 0..1 across the part's image, so `a.at('armRLower', 0.5, 1)` is the bottom of the right forearm (the hand) |
| `a.image(src)` | a cached picture, for example `a.image('media/actions/wave/sparkle.png')`. It is `null` until it has loaded. |
| `a.sound(src, { volume })` | plays a sound, for example `a.sound('user-actions/wave/whoosh.mp3')`. `volume` is 0 to 1. It starts once per run however often you call it, so you can call it from `pose()` when the moment comes: `if (a.t > 0.5) a.sound(…)`. |
| `a.project` | the whole project (read only) |

### The hooks

- **`pose(a)`** adds motion on top of breathing, talking and sway. It returns `{ partId: { ox, oy, rot, sx, sy, scale } }`.
  - `ox`/`oy` are in rig units (the 1000 × 1000 character space) and `rot` is in degrees.
  - Scales multiply.
  - Children follow their parent: rotating `torso` carries the head and arms with it.
- **`states(a)`** overrides the eye and mouth frames, for example `{ eyes: 'closed', mouth: 'open' }`. Eyes take `open half closed`; mouth takes `closed half open`.
- **`parts(a, partId)`** moves one part on its own, in screen space, without moving its children. This is how the avatar-switch animation works. It returns `{ dx, dy, rot, scale, alpha, hide }` or `null`.
- **`behind(a, g)`** and **`front(a, g)`** draw on the canvas behind or in front of the avatar. `g` is a CanvasRenderingContext2D already set to stage units: (0, 0) is the top-left of the stage and `PT.STAGE_W` × `PT.STAGE_H` is the bottom-right. Save and restore yourself if you change more than drawing state.

If a hook throws, that action stops and the editor shows a toast. The avatar keeps running.

### Held actions

An ordinary action plays for its `duration` and ends. A **held** action stays on until it is turned off: a "be right back" pose, a hat, a mood.

```js
PT.Actions.define({
  id: 'lean',
  label: 'Lean back',
  hold: true,               // no duration: it runs until it is stopped
  release: 400,             // ms to blend out once it is stopped (0 to 5000, 300 if left out)

  pose(a) { return { torso: { rot: -8 * a.envelope(300) } }; },
});
```

Inside a held action:

| | |
|---|---|
| `a.held` | `true` |
| `a.ms` | how long it has been on |
| `a.envelope(inMs)` | 0 → 1 as it comes on, 1 → 0 over `release` once it is stopped. Multiply your motion by it and both ends blend. |
| `a.releasing` | 0 while it is on, then 0 → 1 over `release` |
| `a.t`, `a.between()` | always 0, and `a.duration` is `Infinity`: there is no length to be part-way through |
| `a.sound(src, { loop: true })` | a sound that repeats until the action ends |

Turning it on and off:

- In the Actions tab its button says **▶ Turn on** / **■ Turn off**. A hotkey does the same.
- From Streamer.bot, `…?action=lean` turns it on, or off if it is on. `…?action=lean&hold=on` only turns it on and `&hold=off` only turns it off, which is what you want when two different triggers start and end it.
- `…?stop=lean` stops one action. `…?stop=all` stops every action, held or not, and a sequence that is waiting. The tab's **■ Stop all actions** does the same.
- A stage page that loads while it is on (OBS refreshing its source) joins in.
- In a sequence, a held step doesn't make the next step wait.

### Part ids

`torso neck face eyes mouth hairFront hairBack armLUpper armLLower armRUpper armRLower`

- The `L` arm is on the left of the screen and its pivot is the shoulder (upper arm) or the elbow (forearm).
- `face` pivots at the chin.
- Positive `rot` turns clockwise.

### Pictures and sounds

Put files for an action in a folder named after it, next to its file:

- In your actions folder: `actions/<id>/sparkle.png`, used as `a.image('user-actions/<id>/sparkle.png')`.
- Built into the app: `media/actions/<id>/sparkle.png`, used as `a.image('media/actions/<id>/sparkle.png')`. That folder is packed into the app.

Both are served to OBS.

Pictures can be PNG, JPEG, WebP, GIF or SVG. Sounds can be MP3, WAV, OGG or M4A.

**Sounds.** Every page runs every action, but a sound should be heard once. The **Sounds** section of the Actions tab chooses where action sounds play: in EASY-TUBER (the default), in the OBS source or stage window, or nowhere. It also has one volume for all of them. So call `a.sound()` without checking which page you are on.

- A sound longer than the action plays to its end.
- Playing the action again while it runs, or stopping it, cuts the sound.
- If a sound can't be played, the action carries on without it. The reason is in the console (F12).

## How a play travels

```
Test button / hotkey / Streamer.bot URL
  → server (electron/server.js)  checks the id against the actions the editor loaded, times sequences
  → "live" event { type: 'action', id, n, seed, args } to every page
  → PT.Actions.play() in the editor, the stage window and OBS (n stops a double play)
```

The Streamer.bot URL is `http://127.0.0.1:8777/api/streamerbot?action=<id>`. `?stop=<id>` stops one action and `?stop=all` stops everything. For a sequence, use `?sequence=a,b,next&startDelay=1&delay=2.5`, which runs up to 8 steps. Steps can also be `next`, `random` or `avatar:<id>`. Send the header `X-EasyTuber-Control: streamerbot`.

### Saved sequences

A sequence built in the Actions tab can be kept with **Save sequence**. It then has a name, its own global hotkey, and a short address:

```
http://127.0.0.1:8777/api/streamerbot?run=<id>
```

- The address plays the saved steps with the saved timing and values. Change the sequence in EASY-TUBER and Streamer.bot needs no edit.
- Values in the address are added to the saved ones, and win when both have the same name: `…?run=<id>&user=%user%`.
- It waits its turn like any sequence, and cooldowns apply (`&force=1` skips them).
- `startDelay`, `delay`, `queue` and `hold` can't be added: the saved sequence keeps its own timing.
- If a step's action file or avatar is gone, the answer is 404 and the tab marks the sequence.

Saved sequences are stored in the avatar file, shared by all avatars.

### When many requests arrive at once

- **One action** (`?action=wave`) plays straight away. If it is already playing it starts again (or a second copy starts, with `overlap: true`).
- **`?action=wave&queue=1`** waits its turn instead: it plays when whatever is in the queue before it has finished. Use it for redeems that should each be seen in full.
- **A sequence** always waits its turn. Up to 20 can wait; after that the answer is 409.
- **`?stop=all`** empties the queue as well.

The answer to a request that has to wait is `{ "accepted": true, "queued": 2 }`: its place in the queue.

**Cooldown.** Each action has a **Cooldown** under **Settings** in the Actions tab, in seconds. After the action plays, Streamer.bot requests for it get a 429 answer (`"Wave" is cooling down: 12 s left`) until the time has passed. A sequence containing it is refused whole.

- **Test** and your own hotkeys always play. They do start the cooldown again.
- A held action's cooldown is on turning it on. Turning it off always works.
- A request that is waiting in the queue counts from when it was accepted.
- `&force=1` skips the cooldown. The Test button uses it.

### Values from Streamer.bot

Anything else in the URL is passed to the action as `a.args`:

```
http://127.0.0.1:8777/api/streamerbot?action=wave&user=%user%&amount=500
```

- Streamer.bot replaces its own variables, such as `%user%`, before it sends the URL. The **Values for the action** box in the Actions tab adds them to the copied URL as you typed them.
- A name is letters, digits, `-` or `_`, up to 40 characters, and can be used once. `action`, `sequence`, `run`, `startDelay`, `delay`, `stop`, `hold`, `queue` and `force` are taken.
- Up to 16 values, each up to 200 characters.
- Text with `&`, `#` or `+` in it has to be URL-encoded before it goes in the URL, or it is cut short. Names and numbers are fine as they are.
- In a sequence, every action step gets the same values.

A viewer can put anything in a value, so treat it as text to show. Draw it with `g.fillText()`; don't build code or file paths from it.
