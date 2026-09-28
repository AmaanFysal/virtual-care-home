# 02 · World model

**Purpose:** how the wing is represented: floor plan, rooms, doors, furniture, named points, navigation grid, and the state of people.

> Status: decided for Phase 1 (2026-09-28). Source: [plan-v2](research/plan-v2.md) (Map and movement), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §3. Data: `data/floorplan.json`.

**Fixed requirement:** each room stores its **floor area (m²)** and **ceiling height (m)**. A future module will need room volumes, so these are captured now even though v1 does not use them.

## Coordinates

Metres, origin at the top-left of the wing, x to the right, y down (matches the canvas). The wing is 20 m × 13 m.

## Layout

```
x: 0        7.5                            20
y:0 +--------+------------------------------+
    | Room 1 |           Room 2             |   bedrooms 5.5 m deep
    | 2 beds |           4 beds             |
5.5 +--[D]---+--------------[D]-------------+
    |                Corridor               |   2 m wide
7.5 +--[D]------+----[D]-----+----[D]-------+
    | Waiting   | Reception  | Staff Room   |
    | Area      |   Desk     |              |
 13 +-----------+---[Exit]---+--------------+
x:  0           8            14             20
```

| Room id | Name | Rect (x, y, w, h) | Floor area | Ceiling | Notes |
|---|---|---|---|---|---|
| `Room1` | Room 1 | 0, 0, 7.5, 5.5 | 41.25 m² | 2.4 m | Female room: Peggy (BedA), Win (BedB) |
| `Room2` | Room 2 | 7.5, 0, 12.5, 5.5 | 68.75 m² | 2.4 m | Male room: Arthur (A), Raj (B), Stan (C), Dennis (D) |
| `Corridor` | Corridor | 0, 5.5, 20, 2 | 40 m² | 2.4 m | Night lights |
| `WaitingArea` | Guest waiting area | 0, 7.5, 8, 5.5 | 44 m² | 2.4 m | Also the lounge: visitors wait, residents socialise, activities |
| `Reception` | Reception | 8, 7.5, 6, 5.5 | 33 m² | 2.4 m | Desk, exit door to outside |
| `StaffRoom` | Staff room | 14, 7.5, 6, 5.5 | 33 m² | 2.4 m | Handovers; no visitors |

**Toilets:** each bedroom has an en-suite WC, modelled as a named point (`Room1.WC`, `Room2.WC`) drawn as a small labelled square inside the room, not as a separate room. This keeps the six agreed spaces.

## Walls and doors

- **Walls** are line segments along room edges (outer boundary plus internal walls). Doors are gaps on a wall; the renderer draws the wall minus its door gaps.
- **Doors** have an id, the wall they sit on, the gap (x1, y1, x2, y2) and the two rooms they connect. All doors are 1 m wide except the waiting-area opening (2 m). Door state (open / locked) is not modelled in Phase 1: all internal doors are open; the exit door is where people enter and leave the map.
- `ExitDoor` connects Reception to `Outside`. `Outside` is not a room; it is where off-map people are.

## Furniture

Furniture is a labelled rectangle of kind `bed`, `desk`, `table`, `chair`, `sofa` or `wc`.

- `bed`, `desk`, `table` and `sofa` **block** movement.
- `chair` and `wc` do **not** block. A person sits on the point.
- Furniture ids use a lowercase suffix (`Room1.BedA.bed`, `WaitingArea.chair3`, `Reception.desk`) so they never clash with named point ids.

## Named points

Named points are where people go and where interactions happen. Each point has an id, a room and a position.

| Pattern | Meaning |
|---|---|
| `Room1.BedA` | Where the resident lies (bed centre; reached only via "get into bed") |
| `Room1.BedA.Side` | Main bedside standing spot (care, meds, checks, visitors) |
| `Room1.BedA.Side2` | Opposite side of the bed (second carer for two-person tasks) |
| `Room1.BedA.Chair` | Bedside chair (resident sits up, meals, visitors) |
| `Room1.WC`, `Room2.WC` | En-suite toilet |
| `Corridor.West`, `Corridor.Mid`, `Corridor.East` | Corridor waypoints and night-break spots |
| `WaitingArea.Seat1`–`Seat8` | Lounge seats |
| `Reception.Desk` | Visitor sign-in spot (in front of the desk) |
| `Reception.DeskStaff` | Receptionist's seat |
| `Reception.Office` | Wing manager's office desk (a corner of reception; no separate office room) |
| `StaffRoom.Seat1`–`Seat6` | Handover and break seats |
| `ExitDoor` | Just inside the exit; where people appear from and leave to `Outside` |

## Navigation grid

- A hidden grid of 0.5 m cells (40 × 26) is derived from the floor plan at load time.
- A cell is walkable if its centre is inside a room and not inside blocking furniture.
- Walls lie on cell boundaries. A move between two cells is blocked if it crosses a wall segment, unless it crosses inside a door gap. Diagonal moves are allowed only when both orthogonal moves are allowed (no corner-cutting).
- **Doorway cells** are the cells on either side of a door gap. They are single-occupancy: a person waits (event `person.waited_at_door`) until the doorway is clear. Pathfinding details are in [04](04-agents-and-behaviour.md).

## People (engine state)

Every person has:

- **Identity:** id (`res_`, `stf_`, `vis_`, `agy_` for generated agency staff, `ext_` for off-map responders), kind, persona reference.
- **Location:** `onMap` flag, position (x, y in metres), current room id, current path and speed (m/s).
- **Activity:** a posture (`standing`, `walking`, `sitting`, `in_bed`, `on_floor`) and the current task or behaviour-tree node.
- **Needs** (residents), or **workload** and a shift assignment (staff), or a visit plan (visitors). See [04](04-agents-and-behaviour.md).
- **Badges:** short derived labels for the UI (pill, tray, towel, asleep, alert).

## Off-map people

People not on the map (off-shift staff, off-site family, the on-call RN, the off-map second carer, paramedics) exist as records with `onMap: false`. They enter and leave through `ExitDoor`, which emits `person.arrived` / `person.departed` events. A resident conveyed to hospital is off-map with location `hospital`; their bed shows "in hospital".
