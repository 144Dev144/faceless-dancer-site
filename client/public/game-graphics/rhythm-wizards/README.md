RHYTHM WIZARDS asset contract

Drop your production graphics in this folder tree using exactly these names.
No code edits are needed if names stay the same.

Required files:

- `battlefield/background.png`

- `wizards/player/idle.png`
- `wizards/player/move-right-strip.png`
- `wizards/player/move-left-strip.png`
- `wizards/player/attack-strip.png`
- `wizards/player/stagger-strip.png`
- `wizards/player/death-strip.png`

- `wizards/enemy/idle.png`
- `wizards/enemy/move-right-strip.png`
- `wizards/enemy/move-left-strip.png`
- `wizards/enemy/attack-strip.png`
- `wizards/enemy/stagger-strip.png`
- `wizards/enemy/death-strip.png`

- `obstacles/obstacle-1-healthy.png`
- `obstacles/obstacle-1-damaged.png`
- `obstacles/obstacle-1-critical.png`
- `obstacles/obstacle-1-defeated.png`

- `obstacles/obstacle-2-healthy.png`
- `obstacles/obstacle-2-damaged.png`
- `obstacles/obstacle-2-critical.png`
- `obstacles/obstacle-2-defeated.png`

- `controls/left.png`
- `controls/right.png`

Sprite strip expectations:

- Player/Enemy `move-right-strip.png`: 5 horizontal frames
- Player/Enemy `move-left-strip.png`: 5 horizontal frames
- Player/Enemy `attack-strip.png`: 7 horizontal frames
- Player/Enemy `stagger-strip.png`: 8 horizontal frames
- Player/Enemy `death-strip.png`: 6 horizontal frames

Notes:

- Projectile and magic impact effects are generated with CSS.
- If a file is missing, the game still runs and falls back to simple shapes/colors.
- You do not define per-frame offsets. Keep all frames equal width in one horizontal strip.
- Keep transparent backgrounds for sprites and FX.
- Power-of-two sizes are recommended but not required.
