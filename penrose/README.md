# Penrose Tilings

A Penrose tiling explorer and game.

## Files

| File | Purpose |
| --- | --- |
| `penrose.html` | Penrose P3 tiling explorer and level builder |
| `robinson.html` | Robinson triangle / inflation explorer |
| `game.html` | The game |
| `tilings/*.json` | Saved tiling configurations for the explorer |

---

## How to Play

Penrose tiles fall into the well one at a time. Place them to complete vertices — a vertex is "completed" when all tiles meeting at that point are present and obey the current level's matching rules. Complete enough vertices to advance to the next level.

### Controls (desktop)

| Action | Key |
| --- | --- |
| Move | Left / Right |
| Rotate CCW | Z or Up |
| Rotate CW | X |
| Soft drop | Down |
| Pause | P or click top bar |

Auto-drop triggers when a snap-preview stays visible for 0.5 seconds.

### Controls (mobile)

| Action | Gesture |
| --- | --- |
| Move | Drag sideways |
| Rotate CW | Tap left half |
| Rotate CCW | Tap right half |
| Soft drop | Drag down |
| Pause | Tap top bar |

---

## Tile Types

The game uses Penrose P3 tiles and their subdivisions:

| Type | Description |
| --- | --- |
| `thick` | Thick rhombus (72° angles) |
| `thin` | Thin rhombus (36° angles) |
| `thick-half` | Half of a thick rhombus (split along short diagonal) |
| `thin-half` | Half of a thin rhombus |
| `kite` | Kite (used in the pentagon-ground level) |
| `dart` | Dart |
| `pent` | Pentagon |

Rotations are in units of 36° (0–9), so `rotation: 1` = 36°, `rotation: 5` = 180°, etc. Reflection is `1` (normal) or `-1` (mirrored).

---

## Level Structure

There are 9 stages. After stage 9 the cycle repeats from stage 1 at a higher speed. Each stage differs in two ways:

### 1. Ground Configuration

The fixed tiles at the bottom of the well:

| Stage | Ground |
| --- | --- |
| 1 | 5 kites forming a pentagon |
| 2 | 4 thin rhombi in a row |
| 3 | 6 thick rhombi (3 pairs) |
| 4 | 6 thick rhombi in alternating orientations |
| 5 | 4 thin rhombi (same as stage 2) |
| 6 | 4 thin rhombi (same as stage 2) |
| 7 | 6 thick rhombi in pairs (same as stage 3) |
| 8 | 4 pairs of thick rhombi (from `ground4.json`) |
| 9 | 18-tile supertile mix |

### 2. Matching Rules

| Stages | Mode | Rule |
| --- | --- | --- |
| 1–3 | Shapes only | Tiles just need to fit geometrically — no colour or arrow constraints |
| 4–5 | Vertex colours | Touching vertices must share the same colour |
| 6–9 | Full Penrose | Vertex colours and edge arrows must be consistent |

The full Penrose matching rules (colours + arrows) are what enforce the non-periodic tiling property.

### Goal

The goal for level `n` is to complete `n` vertices. It increases every level, and the fall speed increases every full cycle.

---

## Custom Levels

### Using the Level Builder

1. Open the **Level Builder** tab in the game (or open `penrose.html` directly).
2. Design a ground configuration using the P3 tiling tools.
3. Click **Use as Game Level** in the sidebar — this sends the tile data to the game.
4. Choose your matching rules (shapes / colours / full) and click **Start**.

You can also save your design as a `.json` file from the builder and reload it later via **Load Custom Level** on the start screen.

### JSON Format

Saved levels follow this structure:

```json
{
  "version": 1,
  "mode": 0,
  "tiles": [
    { "type": "thick", "wx": -4.38, "wy": 1.21, "rotation": 9, "reflection": 1 },
    ...
  ]
}
```

- `mode`: `0` = shapes only, `1` = vertex colours, `2` = full Penrose rules
- `wx` / `wy`: world-space coordinates (the game re-centres them automatically)
- `rotation`: integer 0–9, each step is 36°
- `reflection`: `1` or `-1`

---

## Adding a Permanent New Level

To bake a custom level into the game as a permanent stage:

### 1. Add the ground data to `GROUND_DATA`

In `game.html` around line 650, paste the `tiles` array from your saved JSON directly — the format is the same:

```js
// ground7: my new level
[
    { type:'thick', wx: 1.23, wy: 4.56, rotation: 3, reflection: 1 },
    // ...
],
```

### 2. Increment `MAX_LEVEL` (line 392)

```js
const MAX_LEVEL = 10;
```

### 3. Update `groundIndex` (line 743)

Map your new stage number to your new `GROUND_DATA` index:

```js
function groundIndex(lvl) {
    const stage = stageLevel(lvl);
    if (stage === 1)  return 4;
    if (stage <= 5)   return (stage-2) % 2;
    if (stage === 8)  return 5;
    if (stage === 10) return 6;  // ← your new entry
    return (stage - 6) % 4;
}
```

### 4. (Optional) Update `levelMode` (line 467)

If you want different matching rules for your stage. By default any stage ≥ 6 uses full Penrose rules (mode `2`).

### 5. (Optional) Increase `LEVEL_PICKER_MAX` (line 393)

So the level picker shows the new stage.
