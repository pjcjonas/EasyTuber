/* Help: a "?" on every part of the window opens a popup that explains it.

   EVERY SECTION NEEDS A TOPIC HERE. A section made with Panels.section('Title', …) gets its "?"
   from the topic 'section:Title' (for 'Frame adjust: Open' it is 'section:Frame adjust'). Each tab
   has 'tab:<data-tab>', and the other areas of the window have their own ids. Adding a section,
   or changing what one does, means adding or updating its topic: tests/help.test.js fails when a
   section has no topic, or a topic's section is gone.

   A topic's body is a list of blocks: a string is a paragraph, an array is a bulleted list and
   { steps: [...] } is a numbered list. **bold** and `code` work inside them. */
(function (PT) {
  const TOPICS = {
    /* ---------------- the whole app, and the areas of the window ---------------- */
    app: {
      title: 'EASY-TUBER help', where: 'Top bar',
      body: [
        'EASY-TUBER turns your drawn layers into a PNGTuber that breathes, blinks and talks to your microphone. Every part of the window has a **?** button that explains it.',
        { steps: [
          'Drop your layers on **Drop all your layers here** in the parts panel.',
          'In **Edit** mode, line the parts up and set their joints.',
          'Click **Start mic** and tune it in the **Mic** tab.',
          'Switch to **Live** to watch it breathe, blink and talk.',
          'Copy the address in the **Stage** tab into an OBS Browser Source.',
        ] },
        'Your avatar saves itself every time you change something.',
      ],
    },
    topbar: {
      title: 'Top bar', where: 'Top of the window',
      body: [
        [
          '**Edit / Live**: Edit holds the rest pose and shows the skeleton so you can line parts up. Live plays breathing, blinking, talking and actions. **Tab** switches between them.',
          '**Undo / Redo** (Ctrl+Z / Ctrl+Shift+Z) take back changes to parts, positions and layers.',
          '**Sprite sheet** crops several parts or frames out of one big image.',
          '**Open file** loads a saved `.easytuber.json`. **Save file** downloads your avatar, pictures included, as one file: use it for backups and to move to another computer.',
          '**Reset** removes all uploads and settings. The avatar you had is kept as a backup (Stage tab → Backups).',
          '**Open stage window** opens a clean window with only the avatar in it, for Window Capture in OBS.',
          '**? Help** opens this help, with a list of every topic.',
        ],
      ],
    },
    parts: {
      title: 'Parts panel', where: 'Left panel',
      body: [
        'Every body part of the avatar on screen, and the box to upload them.',
        [
          '**Drop all your layers here** takes all your PNGs at once and sorts them by file name: `torso.png`, `eyes_closed.png`, `arm_l_upper.png`. A Photoshop `.psd` works too.',
          'Click a part to select it; the **Part** tab then shows its settings. Drop an image on a row to upload just that part.',
          'Under each name: **uploaded** (green), how many of its images you have, or *empty, using placeholder*.',
          '👁 hides or shows a part. 🗑 on a part of your own deletes it from every skin and avatar.',
          '**Whole character** moves and scales the entire avatar.',
          '**Head gear** holds hats, headphones, bows. **＋ Add head gear** picks from your library and accessories; **Upload…** adds new pictures. Each one is a part of its own, attached to the face.',
          '**＋ Add part** adds a part of your own: a tail, a prop, a hand that is separate from the forearm (up to 24).',
          '"Left arm" is the arm on the **left of the screen**.',
          'The **‹** tab on the panel\'s edge slides it away to give the stage more room.',
        ],
      ],
    },
    meter: {
      title: 'Microphone bar', where: 'Bottom of the window',
      body: [
        [
          '**Start mic** turns your microphone on. The meter shows how loud you are.',
          'Drag the white **talk** marker to where the mouth starts to open (half), and the purple **open** marker to where it opens fully.',
          'Talk normally: the bar should pass **talk** on every word and **open** on louder syllables.',
          'The chips show what the mouth and eyes are doing right now.',
          '**Hold to test talk** (or hold **Space**) fakes talking without a microphone.',
        ],
        'The **Mic** tab has the same settings as numbers, and **Tune to my voice**.',
      ],
    },
    sheet: {
      title: 'Sprite sheet', where: 'Top bar → Sprite sheet, or Part tab → From sprite sheet…',
      body: [
        'Crops parts or frames out of one big image: all the eye frames side by side, or a whole character laid out on one sheet.',
        [
          'Drag on empty space to draw a box. Drag a box or its handles to adjust it.',
          'Wheel zooms; right-drag or Space+drag pans; arrow keys nudge the selected box; Delete removes it.',
          'Choose which part (and frame) each box is for under **Crop boxes**.',
          '**Crop into rig** cuts the boxes out and puts them on those parts.',
          'The sheet is saved with your avatar: **Edit sprite sheet crop…** on a part, or Stage tab → Sprite sheets, opens the boxes again.',
        ],
      ],
    },
    psd: {
      title: 'Import a Photoshop file', where: 'Drop a .psd on the parts panel or the stage',
      body: [
        'The list shows every layer and the part it will go to. Change any choice, then click **Import**.',
        [
          'Layers are matched by name, like files: `face`, `eyes closed`, `arm left upper`.',
          'A layer with a plain name (`open`, `Layer 3`) takes its part from its group: `open` in a group called `Eyes` is the open eyes.',
          'A layer that matches no part is offered as **a new part of its own**, attached to the part its group stands for.',
          'Hidden layers are listed too, since closed eyes and open mouths are usually hidden.',
          'Several layers sent to the same part are combined into one image.',
        ],
        'Every image is made at the size of the whole document, so the parts sit where they do in Photoshop. They go into the avatar on screen and replace those parts\' images. Layer effects, blend modes and masks are not applied: flatten them first.',
      ],
    },

    /* ---------------- the tabs ---------------- */
    'tab:part': {
      title: 'Part tab', where: 'Right panel',
      body: [
        'Shows the part you selected on the stage or in the parts panel.',
        [
          'Nothing selected: how to get started, and the shortcuts.',
          '**Whole character**: where the whole avatar sits and how big it is.',
          'A part: its images, other options to swap in, its position, joint, layer and tools.',
        ],
        'What you change here belongs to the skin or avatar on screen. Click a section\'s **?** for its details.',
      ],
    },
    'tab:motion': {
      title: 'Motion tab', where: 'Right panel',
      body: [
        'All the motion is built in. These sliders only set how strong each kind is: 1 is the default and 0 turns it off. Switch to **Live** to see the result.',
        'Motion settings are shared by all your skins and avatars. **Reset motion to defaults** puts every slider back.',
      ],
    },
    'tab:mic': {
      title: 'Mic tab', where: 'Right panel',
      body: [
        'Which microphone drives the mouth, and how loud you have to be for it to open. The settings are shared by all your skins and avatars.',
        'Quickest setup: **Start / stop mic**, then **Tune to my voice**.',
      ],
    },
    'tab:stageTab': {
      title: 'Stage tab', where: 'Right panel',
      body: [
        'Everything about what goes on stream, and settings for the editor itself: the background, the virtual camera, the look on stream, the draw order, the OBS address and your backups.',
      ],
    },
    'tab:avatars': {
      title: 'Avatars tab', where: 'Right panel',
      body: [
        'Keep several looks and characters, and switch between them with keys on your keyboard, even while you are in a game.',
        [
          '**Skins** are looks of your main character; **avatars** are other characters.',
          '**Expressions** swap a few parts for a happy, angry or surprised face.',
          'The **parts library** holds parts to build new looks from.',
        ],
      ],
    },
    'tab:actions': {
      title: 'Actions tab', where: 'Right panel',
      body: [
        'Actions are animations you play on demand: a hop, a wave, a victory pose. Play one with **▶ Test**, a hotkey or Streamer.bot. It plays in the editor, the stage window and OBS at the same time.',
        'EASY-TUBER comes with the ten actions of the High energy pack. You can add your own as files in the actions folder.',
      ],
    },
    'tab:accessories': {
      title: 'Accessories tab', where: 'Right panel',
      body: [
        'Pictures you put on: hats, glasses, bows, collars, props. Upload one once, then put it on any skin or avatar.',
      ],
    },

    /* ---------------- Part tab ---------------- */
    'section:Shortcuts': {
      title: 'Shortcuts', where: 'Part tab (nothing selected)',
      body: [
        'Keyboard and mouse shortcuts for the stage. They don\'t work while you are typing in a box.',
        [
          '**Space** (hold): fake talking. **B**: blink. **Tab**: switch Edit / Live.',
          '**Arrows**: nudge the selected part (Shift = 10 px).',
          '**Wheel** scales, **Shift+wheel** rotates. **Shift+drag** locks to an axis or snaps the rotation.',
          '**Alt+drag** moves the whole character.',
          '**Ctrl+Z** undoes, **Ctrl+Shift+Z** redoes. **Esc** deselects.',
        ],
      ],
    },
    'section:Transform': {
      title: 'Transform', where: 'Part tab → Whole character',
      body: [
        [
          '**X** and **Y** move the whole avatar inside the capture frame.',
          '**Scale** makes it bigger or smaller, from its bottom centre.',
          '**Reset** puts it back in the middle at full size.',
          'On the stage, **Alt+drag** does the same as X and Y.',
        ],
      ],
    },
    'section:This part': {
      title: 'This part', where: 'Part tab (a part of your own)',
      body: [
        [
          'The **name** shows in the parts panel. A dropped file goes to this part when its file name contains the part\'s name.',
          '**Listed under** chooses its section in the parts panel: Head gear, or Your parts.',
          '**Attached to** is the part it moves with. It can be a built-in part or one of your parts above it in the list.',
          '**Sway** is how much it swings behind that part when it turns. 0 keeps it stiff, as glasses should be.',
          'The **id** in the note is the name an action uses for it.',
          '**Delete part** removes it, and its images, from every skin and avatar.',
        ],
        'The part exists in every skin and avatar; each one has its own image and placement for it.',
      ],
    },
    'section:Images': {
      title: 'Images', where: 'Part tab',
      body: [
        [
          'Each slot is one image of this part. Eyes have **Open**, **Half** and **Closed**; the mouth has **Closed**, **Half** and **Open**. Half is optional.',
          'The mouth can also have the vowel shapes **Ah**, **Oh / Oo** and **Ee / Eh**: while you talk it takes the shape of the vowel you are saying.',
          'Click an empty slot or drop an image on it to upload. Double-click a filled slot to replace it; **×** removes it.',
          'Click a filled slot to preview that image on the stage while you line it up.',
          'With expressions, the dropdown above the slots chooses whose images you see: **Normal** or an expression. A slot left empty for an expression uses the normal image.',
          '**From sprite sheet…** crops this part\'s images out of one bigger picture.',
        ],
      ],
    },
    'section:Swap part': {
      title: 'Swap part', where: 'Part tab',
      body: [
        'Other versions of this part that you can put on the avatar on screen with one click.',
        [
          'Pictures come from your other skins and avatars, from the parts library and, for parts of your own, from your accessories.',
          'Click one to use it. **↩ Undo swap** puts the old one back.',
          '**Show library parts made for other parts too** lists everything in the library, to put a sticker on any part, for example.',
          '**Save to library** keeps this part, with its pictures and placement, in the parts library.',
          '**Upload options…** (or drop pictures on the box) adds new options without changing the avatar. Frames of one item, such as `eyes_open` and `eyes_closed`, stay together.',
        ],
      ],
    },
    'section:Frame adjust': {
      title: 'Frame adjust', where: 'Part tab (eyes, mouth)',
      body: [
        'Lines up one frame with the others, when a frame is slightly off.',
        [
          'It changes only the frame you are previewing (click a filled slot under Images to choose it).',
          '**Offset X / Y** nudge it; **Scale** resizes it.',
          'The first frame shows faintly underneath (onion skin), so you can match them.',
          '**Reset this frame** undoes the adjustment. **Next frame →** steps through the frames to check them.',
        ],
      ],
    },
    'section:Position': {
      title: 'Position', where: 'Part tab',
      body: [
        'Exact numbers for where the selected part is. You can also do all of this on the stage in Edit mode.',
        [
          '**X / Y** are the position of the part\'s joint. On the stage: drag the part.',
          '**Scale**: on the stage, drag the square handle or use the wheel.',
          '**Rotation**: drag the circle handle or use Shift+wheel.',
          '**Flip horizontally** mirrors the image. **Visible** hides or shows the part.',
          'Moving a part moves the parts attached to it (Stage tab → Editor can turn that off).',
        ],
      ],
    },
    'section:Joint (pivot)': {
      title: 'Joint (pivot)', where: 'Part tab',
      body: [
        'The point this part turns around and attaches to its parent with: the shoulder, the elbow, the chin.',
        [
          'Drag the **orange cross** on the stage, or type **Pivot X / Y**.',
          'Put it where the part really bends. If gaps open between parts when they move, the joint is in the wrong place.',
          'Moving the joint doesn\'t move the image.',
        ],
      ],
    },
    'section:Layer': {
      title: 'Layer', where: 'Part tab',
      body: [
        'Which parts are drawn in front of which.',
        [
          '**↓ Send back** moves the part behind the one under it; **↑ Bring forward** moves it in front of the one above it.',
          'Layer 1 is furthest back.',
          'Stage tab → Draw order shows every part in one list.',
        ],
      ],
    },
    'section:Tools': {
      title: 'Tools', where: 'Part tab',
      body: [
        [
          '**Auto-place** fits the image again and works out its joint, as when it was first uploaded. Use it if a part has wandered off.',
          '**Mirror to other arm** (arms only) copies this arm, both pieces, to the other side, mirrored. Handy when you drew one arm.',
        ],
      ],
    },

    /* ---------------- Motion tab ---------------- */
    'section:Breathing': {
      title: 'Breathing', where: 'Motion tab',
      body: [[
        '**Speed**: seconds per breath. Higher is slower.',
        '**Amount**: how much the body rises with each breath.',
        '**Idle sway**: a gentle drift of the head and body while you are quiet.',
      ]],
    },
    'section:Blinking': {
      title: 'Blinking', where: 'Motion tab',
      body: [[
        '**Every**: about how many seconds pass between blinks.',
        '**Double blink**: how often a blink comes in twos.',
        '**Blink now** (or **B**) blinks once, here and in OBS.',
        'Blinks are smoother with a **Half** eyes image.',
      ]],
    },
    'section:Talking': {
      title: 'Talking', where: 'Motion tab',
      body: [
        'How the avatar moves with your voice.',
        [
          '**Head bob**: the head hops on each syllable.',
          '**Head tilt**: the head rocks side to side.',
          '**Body bounce**: the body bounces as you talk.',
          '**Gestures**: the arms move when you talk.',
        ],
      ],
    },
    'section:Secondary motion': {
      title: 'Secondary motion', where: 'Motion tab',
      body: [[
        '**Arm sway**: the arms move a little while idle.',
        '**Hair physics**: how much the hair swings after the head moves.',
      ]],
    },
    'section:Follow the mouse': {
      title: 'Follow the mouse', where: 'Motion tab',
      body: [
        'The avatar looks towards your mouse pointer, wherever it is on your screen. 0 turns it off.',
        [
          '**Eyes follow mouse**: how far the eyes move towards the pointer.',
          '**Head follows mouse**: how far the head turns.',
        ],
        'It reads only where the pointer is; nothing is kept or sent anywhere. It works in the desktop app, and the avatar in OBS follows too.',
      ],
    },

    /* ---------------- Mic tab ---------------- */
    'section:Input': {
      title: 'Input', where: 'Mic tab',
      body: [[
        'Choose which **microphone** to use.',
        '**Start / stop mic** turns it on or off, like the button under the stage.',
        '**Tune to my voice**: stay quiet while it says *Stay quiet…* (1.5 s), then talk normally while it says *Now talk normally…* (3 s). It sets the talk and open levels from your room noise and your voice.',
      ]],
    },
    'section:Sensitivity': {
      title: 'Sensitivity', where: 'Mic tab',
      body: [
        [
          '**Sensitivity** boosts or lowers the input level.',
          '**Talk at**: the level where the mouth starts to open (half).',
          '**Open at**: the level where it opens fully.',
          '**Hold**: how long the mouth stays open after you stop, in ms. Longer is calmer.',
        ],
        'Talk at and Open at are the white and purple markers on the meter under the stage. If the mouth flaps on background noise, raise Talk at or lower Sensitivity.',
      ],
    },
    'section:Tips': {
      title: 'Tips', where: 'Mic tab',
      body: [
        'Quick reminders for setting up the microphone.',
        'If the meter doesn\'t move at all, check **Input**, and allow EASY-TUBER to use the microphone in your system\'s privacy settings.',
      ],
    },

    /* ---------------- Stage tab ---------------- */
    'section:Background': {
      title: 'Background', where: 'Stage tab',
      body: [[
        '**Transparent** (the checkerboard) is best for an OBS Browser Source: no chroma key needed.',
        '**Green**, **blue** or **magenta** are for Window Capture of the stage window with a Chroma Key filter.',
        'The last swatch picks any colour.',
        'The virtual camera can\'t be transparent: it uses this colour, and Transparent shows black.',
      ]],
    },
    'section:Virtual camera': {
      title: 'Virtual camera', where: 'Stage tab',
      body: [
        'Shows your avatar as a webcam in Zoom, Discord, Teams and other programs.',
        { steps: [
          'Install OBS Studio. It doesn\'t have to be running. On a Mac, start and stop its virtual camera once and allow the camera extension in System Settings.',
          'Click **Start camera**.',
          'In your call or chat program, choose **OBS Virtual Camera** as the camera.',
        ] },
        'The picture is 1920 × 1080 at 30 frames a second. Only one program can send to the camera at a time, so stop OBS\'s own virtual camera first.',
      ],
    },
    'section:Editor': {
      title: 'Editor', where: 'Stage tab',
      body: [
        'How the editor behaves. None of these change what goes on stream.',
        [
          '**Show placeholder art for empty parts**: parts you haven\'t uploaded show the built-in character.',
          '**Show joints and bones**: the skeleton in Edit mode.',
          '**Dragging a part moves the parts attached to it**: moving the face also moves the eyes, mouth and hair.',
          '**Onion skin**: shows the first frame faintly while you line up eye or mouth frames.',
        ],
      ],
    },
    'section:Updates': {
      title: 'Updates', where: 'Stage tab',
      body: [
        'Which version you have, and whether to hear about new ones.',
        '**Tell me when a new version is out** asks github.com once when the app starts. Nothing about you or your avatar is sent.',
      ],
    },
    'section:Look on stream': {
      title: 'Look on stream', where: 'Stage tab',
      body: [
        [
          '**Dim when quiet** darkens the avatar while you are not talking. 0 turns it off.',
          '**Outline** draws a sticker outline around the whole avatar, in the **Outline colour**. 0 turns it off.',
          '**Shadow** puts a soft shadow behind the avatar. 0 turns it off.',
        ],
        'They show in Live, the stage window, OBS and the virtual camera, not while you edit.',
      ],
    },
    'section:Sprite sheets': {
      title: 'Sprite sheets', where: 'Stage tab',
      body: [[
        'The sheets you have cropped parts from.',
        '**Edit** opens a sheet\'s boxes again, to change the crops.',
        '🗑 forgets the sheet. The images you cropped from it stay.',
        '**Add sprite sheet…** opens a new one.',
      ]],
    },
    'section:Draw order (top = front)': {
      title: 'Draw order', where: 'Stage tab',
      body: [[
        'Every part, front to back: the part at the top is drawn in front of everything.',
        '**↑** and **↓** move a part forward or back.',
        'Click a name to select that part.',
        'Each skin and avatar has its own order.',
      ]],
    },
    'section:Streaming with OBS': {
      title: 'Streaming with OBS', where: 'Stage tab',
      body: [
        { steps: [
          'Click **Copy** to copy the address.',
          'In OBS: **Sources → + → Browser**. Paste the address, width **1920**, height **1080**.',
          'Leave the Background on **Transparent**.',
          'Keep EASY-TUBER open with the mic on. It can be minimised.',
        ] },
        'If port 8777 is busy, the app uses the next free one and this address changes: copy it again.',
        'Alternative: choose a green Background, click **Open stage window** in the top bar, and capture *EASY-TUBER Stage* with a Chroma Key filter.',
      ],
    },
    'section:Backups': {
      title: 'Backups', where: 'Stage tab',
      body: [[
        'The app keeps a copy of your avatar file each time it starts, and before a reset or a restore.',
        'The newest 5 are listed. **Restore** goes back to one; the avatar you had becomes a backup too.',
        'For a copy you keep yourself, use **Save file** in the top bar.',
      ]],
    },

    /* ---------------- Avatars tab ---------------- */
    'section:My skins': {
      title: 'My skins', where: 'Avatars tab',
      body: [
        'The looks of your main character: outfits, moods, seasons. Hotkeys, Next skin and Random mix switch between these.',
        [
          '**Show** puts a skin on screen. Type in its name box to rename it.',
          '**Set key** gives it a global hotkey (see About hotkeys).',
          '**→ Avatars** moves it to the Avatars list. 🗑 deletes it.',
          '**+ New skin** starts from the placeholder. **Duplicate as skin** copies what is on screen: the quick way to make an outfit change.',
          '**Add from file…** adds the skins and avatars from a saved `.easytuber.json`.',
        ],
        'Each skin has its own images, positions and draw order. Motion, mic and stage settings are shared.',
      ],
    },
    'section:Avatars': {
      title: 'Avatars', where: 'Avatars tab',
      body: [
        'Characters of their own: a pet, a sidekick, a guest. They have no switching hotkeys and Next skin and Random mix leave them out.',
        [
          '**Edit** puts one on screen so you can work on it. OBS shows it too while it is on.',
          '**← Skins** moves it to My skins.',
          '**+ New avatar** starts from the placeholder; **Duplicate as avatar** copies what is on screen.',
        ],
      ],
    },
    'section:Random mix': {
      title: 'Random mix', where: 'Avatars tab',
      body: [[
        'Builds a new look from your skins: each part comes from a random skin. Both pieces of an arm always come from the same one.',
        'Give it a hotkey, or click **🎲 Mix now**. Every press makes a new mix.',
        '**Keep this mix** saves the one on screen as a new skin.',
        'It works best when your skins were drawn on the same canvas, in the same pose.',
      ]],
    },
    'section:Expressions': {
      title: 'Expressions', where: 'Avatars tab',
      body: [
        'A face you switch to: happy, angry, surprised. It swaps the images of the parts you choose; the avatar keeps blinking, talking and moving.',
        { steps: [
          '**+ New expression**, then type its name.',
          'Select a part that should look different. In the Part tab, choose the expression above the image slots and give it images. Do the same for any other part.',
          '**Show** puts it on, in Live, the stage window and OBS; **Turn off** goes back to normal.',
        ] },
        [
          '**Set key** gives it a hotkey: press once to put it on, again to take it off.',
          '**Copy address** gives the Streamer.bot address. Add `&for=5` to show it for 5 seconds.',
          'A part of your own with an image only for an expression shows only while it is on: tears, a sweat drop.',
        ],
      ],
    },
    'section:Parts library': {
      title: 'Parts library', where: 'Avatars tab',
      body: [
        'Parts kept apart from your avatars, to build new looks from. It is shared by all avatars and saved in your avatar file.',
        [
          '**Upload parts…** (or drop pictures) adds many at once. They are sorted by file name, like dropped layers; frames of one item, such as `eyes_open.png` and `eyes_closed.png`, stay together.',
          'Rename a part, change which part it is for, or 🗑 delete it. Avatars that use it keep it.',
          'To use one: select the part on the stage and click it under **Swap part** in the Part tab.',
        ],
      ],
    },
    'section:Build a mix': {
      title: 'Build a mix', where: 'Avatars tab',
      body: [[
        'Like Random mix, but you choose: one row per part, each with the skin it comes from.',
        'Change a row and the stage and OBS show the result straight away. Your skins are not changed.',
        '**Save as skin** keeps the mix as a new skin.',
        'It needs at least two skins.',
      ]],
    },
    'section:Next skin': {
      title: 'Next skin', where: 'Avatars tab',
      body: ['A hotkey that steps through your skins in order, one per press.'],
    },
    'section:Switch animation': {
      title: 'Switch animation', where: 'Avatars tab',
      body: [[
        'When it is on, switching skins makes the parts drop off the screen and the new look climb back in, in the editor and in OBS.',
        '**Test the animation** plays it here and in OBS.',
      ]],
    },
    'section:About hotkeys': {
      title: 'About hotkeys', where: 'Avatars tab',
      body: [[
        'Click **Set key**, then press the combination, such as **Ctrl+Alt+1**. Esc cancels; Backspace removes the key.',
        'A key needs Ctrl, Alt or Shift with it, except F-keys and numpad keys, so your normal typing keeps working.',
        'Hotkeys work in any program, even in a game, as long as EASY-TUBER is running.',
        'Keys you bind don\'t reach other programs while EASY-TUBER runs, so pick ones you don\'t need elsewhere.',
        'A key shown in **red** is taken by another program: pick a different one.',
      ]],
    },

    /* ---------------- Actions tab ---------------- */
    'section:Your actions': {
      title: 'Your actions', where: 'Actions tab',
      body: [
        [
          'Choose an action in the dropdown; its controls show below it.',
          '**▶ Test** plays it here, in the stage window and in OBS. A held action has **▶ Turn on** / **■ Turn off** instead: it stays on until you turn it off.',
          '**Set key** gives it a global hotkey.',
          '**Settings** are the action\'s own sliders and checkboxes. **Cooldown** is how many seconds Streamer.bot must wait before playing it again; Test and hotkeys always play.',
          '**■ Stop all actions** stops everything playing, and a sequence that is waiting.',
          '**Open actions folder** is where your own action files go; **Reload actions** loads them again. A file with a mistake is skipped, and the tab says why.',
        ],
        'Only add action files you trust: an action is a small program. A file with the same id as a built-in action replaces it.',
      ],
    },
    'section:Sounds': {
      title: 'Sounds', where: 'Actions tab',
      body: [
        'For actions that come with sounds.',
        [
          '**In EASY-TUBER** plays through your speakers; your stream hears it if you capture desktop sound.',
          '**In the OBS source or stage window** plays inside OBS. Tick **Control audio via OBS** on the Browser Source to give it its own mixer slider.',
          '**Nowhere** mutes them. **Volume** sets one level for all of them.',
        ],
      ],
    },
    'section:Streamer.bot': {
      title: 'Streamer.bot', where: 'Actions tab',
      body: [
        'Makes an address that plays an action, or a sequence, when Streamer.bot calls it.',
        { steps: [
          'Pick an action (or Next skin, Random mix, Show an avatar). **▶ Test** tries it.',
          'For several in a row, click **Add to sequence** for each (up to 8). Set the start delay and the time between steps; *Auto* waits for each step to finish.',
          'Optional: **Values for the action**, such as `user=%user%`. Streamer.bot fills in its own variables.',
          'Click **Copy**. In Streamer.bot add a **Fetch URL** sub-action, paste it, and add the header `X-EasyTuber-Control` with the value `streamerbot`.',
        ] },
        'For a held action the address turns it on, or off if it is on; `&hold=on` only turns it on. **Save sequence** keeps a sequence under Saved sequences. EASY-TUBER must be running.',
      ],
    },
    'section:Saved sequences': {
      title: 'Saved sequences', where: 'Actions tab',
      body: [[
        'Sequences you kept with **Save sequence**, with their timing and values.',
        'Type in the name box to rename one. **▶ Play** plays it; **Set key** gives it a hotkey.',
        '**Copy address** gives a short Streamer.bot address that stays the same when you change the sequence later.',
        '✕ deletes it. A sequence whose action or avatar is gone is marked *Missing*.',
      ]],
    },

    /* ---------------- Accessories tab ---------------- */
    'section:Accessories': {
      title: 'Accessories', where: 'Accessories tab',
      body: [[
        'Click **Upload accessories…**, or drop pictures on it. Each picture becomes an accessory named after its file.',
        'Then put it on from its card under Your accessories.',
        '**A new part for it** makes a part named after the accessory, attached to the face. Every skin and avatar gets that part, empty until something is put on it.',
      ]],
    },
    'section:Your accessories': {
      title: 'Your accessories', where: 'Accessories tab',
      body: [
        [
          'Choose **Put it on** (a skin or an avatar, not only the one on screen) and **as** (one of your own parts, or a new part), then click **Put it on**.',
          '**Worn by** lists who wears it; **✕** takes it off that one.',
          '🗑 deletes the accessory. Avatars wearing it keep it.',
          'Type in the name box to rename it.',
        ],
        'On the skin on screen it lines up with layers drawn on the same canvas; otherwise it goes at the part\'s joint, sized to fit. Move it in Edit mode like any part.',
      ],
    },

    /* ---------------- Sprite sheet window ---------------- */
    'section:Split into a grid': {
      title: 'Split into a grid', where: 'Sprite sheet',
      body: [[
        '**Columns** and **Rows** split the sheet into equal cells.',
        '**Assign in order to** is the part the cells go to, in the order of its frames (Open, Half, Closed for eyes).',
        'Equal cells keep animation frames aligned: best for eyes and mouths.',
      ]],
    },
    'section:Find sprites automatically': {
      title: 'Find sprites automatically', where: 'Sprite sheet',
      body: [[
        '**Detect sprites** draws a box around each separate drawing on a transparent sheet.',
        '**Join pieces closer than** joins pieces that are this close (in pixels) into one box. Raise it if a pair of eyes gets split in two.',
      ]],
    },
    'section:Crop boxes': {
      title: 'Crop boxes', where: 'Sprite sheet',
      body: [[
        'Every box on the sheet. Choose the part, and the frame, each box is for.',
        '**+ Add box** adds one; you can also drag on empty space on the sheet.',
        '**Keep all boxes the same size**: resizing one resizes them all, so frames stay aligned.',
      ]],
    },
  };

  // the topic for a section title; 'Frame adjust: Open' uses the one for 'Frame adjust'
  const sectionKey = (title) => 'section:' + String(title).split(':')[0].trim();

  // **bold** and `code` inside a line of text, as DOM nodes (never as HTML)
  function inline(text) {
    const out = [];
    const re = /\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(m[1] ? PT.el('strong', {}, m[1]) : m[2] ? PT.el('code', {}, m[2]) : PT.el('em', {}, m[3]));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  const Help = {
    TOPICS, sectionKey,
    has(id) { return Object.prototype.hasOwnProperty.call(TOPICS, id); },
    // a dialog under the popup leaves the keys (Esc above all) to it while it is open
    get isOpen() { return !!this.back; },
    get(id) { return this.has(id) ? TOPICS[id] : null; },

    // a small "?" button for a topic (or null when there is none)
    button(id, label) {
      if (!this.has(id)) { console.warn('No help topic: ' + id); return null; }
      return PT.el('button', { class: 'help-btn', type: 'button', 'data-help': id, title: 'Help: ' + (label || TOPICS[id].title), 'aria-label': 'Help: ' + (label || TOPICS[id].title) }, '?');
    },

    // the id a data-help value stands for: "tab" is the tab that is open
    resolve(id) {
      if (id !== 'tab') return id;
      const on = document.querySelector('.tab.active');
      return on ? 'tab:' + on.dataset.tab : 'app';
    },

    blocks(body) {
      return body.map((b) => {
        if (typeof b === 'string') return PT.el('p', {}, inline(b));
        if (Array.isArray(b)) return PT.el('ul', { class: 'help-points' }, b.map((li) => PT.el('li', {}, inline(li))));
        return PT.el('ol', { class: 'help-points' }, b.steps.map((li) => PT.el('li', {}, inline(li))));
      });
    },

    // every topic, grouped the way the window is laid out, as links (shown in the app topic)
    index() {
      const link = (id) => PT.el('button', { class: 'help-link', type: 'button', onclick: () => this.open(id) }, TOPICS[id].title);
      const groups = [['The window', ['topbar', 'parts', 'meter', 'sheet', 'psd']]];
      for (const b of document.querySelectorAll('.tab')) {
        const tab = 'tab:' + b.dataset.tab, title = TOPICS[tab].title;
        groups.push([title, [tab, ...Object.keys(TOPICS).filter((k) => k.startsWith('section:') && TOPICS[k].where.startsWith(title))]]);
      }
      groups.push(['Sprite sheet', Object.keys(TOPICS).filter((k) => k.startsWith('section:') && TOPICS[k].where === 'Sprite sheet')]);
      return PT.el('div', { class: 'help-index' }, groups.map(([title, ids]) =>
        PT.el('div', { class: 'help-group' }, PT.el('div', { class: 'help-group-title' }, title), PT.el('div', { class: 'help-links' }, ids.map(link)))));
    },

    open(id) {
      id = this.resolve(id);
      const t = this.get(id) || TOPICS.app;
      this.close();
      const close = () => this.close();
      const body = PT.el('div', { class: 'help-body' }, this.blocks(t.body), id === 'app' ? this.index() : null);
      this.back = PT.el('div', { class: 'modal-back help-back', onclick: (e) => { if (e.target === this.back) close(); } },
        PT.el('div', { class: 'modal help-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.title },
          PT.el('header', { class: 'modal-head' },
            PT.el('span', { class: 'help-mark', 'aria-hidden': 'true' }, '?'),
            PT.el('div', { class: 'help-titles' }, PT.el('h2', {}, t.title), PT.el('span', { class: 'part-sub' }, t.where)),
            PT.el('button', { class: 'icon-btn close', type: 'button', title: 'Close (Esc)', onclick: close }, '✕')),
          body,
          PT.el('footer', { class: 'modal-foot' },
            id === 'app' ? PT.el('span', { class: 'note' }, 'Click a topic to read it.') : PT.el('button', { class: 'btn ghost', type: 'button', onclick: () => this.open('app') }, 'All help topics'),
            PT.el('button', { class: 'btn primary', type: 'button', onclick: close }, 'Got it'))));
      document.body.append(this.back);
      // while it is open, keys belong to it: Esc closes, and nothing reaches the stage shortcuts
      this.onKey = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); close(); }
      };
      window.addEventListener('keydown', this.onKey, true);
      this.back.querySelector('.btn.primary').focus();
      return t;
    },

    close() {
      if (!this.back) return;
      window.removeEventListener('keydown', this.onKey, true);
      this.back.remove();
      this.back = null;
    },

    // any element with data-help="<topic>" opens that topic when clicked (also ones added later)
    init() {
      document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('[data-help]');
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        this.open(b.getAttribute('data-help'));
      }, true);
    },
  };

  PT.Help = Help;
  if (typeof document !== 'undefined' && document.addEventListener) Help.init();
})(window.PT);
