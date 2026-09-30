# 02 · World model

**Purpose:** how the wing is represented: floor plan, rooms, doors, furniture, named points, navigation grid, and the state of people.

> Status: decided for Phase 1 (2026-09-28). Source: [plan-v2](research/plan-v2.md) (Map and movement), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §3. Data: `data/floorplan.json`.

**Fixed requirement:** each room stores its **floor area (m²)** and **ceiling height (m)**. A future module will need room volumes, so these are captured now even though v1 does not use them.

## Coordinates

Metres, origin at the top-left of the wing, x to the right, y down (matches the canvas). The wing is 33.5 m × 13 m.

## Layout

```
x: 0     4      8      12     16     20     24                33.5
y:0 +------+------+------+------+------+------+------------------+
    |Rm 1  |Rm 2  |Rm 3  |Rm 4  |Rm 5  |Rm 6  |                  |   single bedrooms and Lounge 5.5 m deep
    |Arthur| Win  | Raj  | Stan |Peggy |Dennis|      Lounge      |
3.5 |+--+  |+--+  |+--+  |+--+  |+--+  |+--+  |  TV and sofa,    |   en-suite: 1.5 x 2 m, door into the bedroom
    ||WC]  ||WC]  ||WC]  ||WC]  ||WC]  ||WC]  |  dining, reading |
5.5 +--+--[D]--+--[D]-+--[D]-+--[D]-+--[D]-+-[D]-----[ D ]-------+
    |                      Corridor                        |   2 m wide
7.5 +--[D]------+----[D]-----+----[D]-------+--------------+
    | Waiting   ]  Reception | Staff Room   |   (garden)
    | Area      ]<-door Desk |              |
 13 +-----------+---[Exit]---+--------------+
x:  0           8            14             20
```

Six **single en-suite bedrooms** (Room 1 to Room 6) sit along the north side, with the Lounge at the east end. Each bedroom is 4 × 5.5 m: one bed centred against the outer wall under its window, with **1.5 m of clear floor on both sides** for two carers (turns, hoisting), and a walled en-suite (1.5 × 2 m) in the corner by the corridor door. The en-suite door opens into the bedroom (1.0 m on the walking grid, 0.9 m clear width). That leaves 19 m² of bedroom, well above the 12 m² UK minimum for a single room. Raj's wheelchair spot is at the foot of his bed, with at least 1 m of clear floor around it. The waiting area has two doors, one to the corridor and one straight into reception. The block south of the Lounge (x 20 to 33.5, y 7.5 to 13) is outside the wing (the garden).

**Room allocation** (by need, nearest the staff-room door at x 17 for those who need staff most):

| Room | From the staff-room door | Resident | Why |
|---|---|---|---|
| 5 | 2 m | Peggy | Highest falls risk, zimmer, 2-hourly toilet prompts, female-only care: the room staff pass most, and nearer the Lounge for her escorted trips |
| 4 | 2 m | Stan | High falls risk, wanders at night, escorted to the Lounge |
| 3 | 6 m | Raj | Frequent two-person hoist work, mid-wing |
| 6 | 6 m | Dennis | Bed-bound, 2-hourly turns; by the Lounge end and the nurse's corridor post |
| 2 | 10 m | Win | Mild dementia, walks with a stick, independent toileting |
| 1 | 14 m | Arthur | Full capacity, independent, walks to the Lounge alone |

| Room id | Name | Kind | Rect (x, y, w, h) | Floor area | Ceiling | Notes |
|---|---|---|---|---|---|---|
| `Room1` … `Room6` | Room 1 … Room 6 | bedroom | 4·(n−1), 0, 4, 5.5 | 19 m² (excluding the en-suite) | 2.4 m | Single rooms: Arthur, Win, Raj, Stan, Peggy, Dennis |
| `Ensuite1` … `Ensuite6` | Room n en-suite | ensuite | 4·(n−1), 3.5, 1.5, 2 | 3 m² | 2.4 m | Toilet and basin; a room inside its bedroom |
| `Lounge` | Lounge | lounge | 24, 0, 9.5, 5.5 | 52.25 m² | 2.4 m | Residents' day room and dining room: a TV corner with armchairs and a sofa, a dining table for six, a reading corner, an activity table. About 8.7 m² per resident (the old National Minimum Standards asked for at least 4.1) |
| `Corridor` | Corridor | corridor | 0, 5.5, 33.5, 2 | 67 m² | 2.4 m | Night lights |
| `WaitingArea` | Waiting area | waiting | 0, 7.5, 8, 5.5 | 44 m² | 2.4 m | Visitors only (waiting, protected lunch); doors to the corridor and to reception |
| `Reception` | Reception | reception | 8, 7.5, 6, 5.5 | 33 m² | 2.4 m | Desk, exit door to outside |
| `StaffRoom` | Staff room | staff | 14, 7.5, 6, 5.5 | 33 m² | 2.4 m | Handovers and day breaks; no visitors |

**Rooms inside rooms:** an en-suite is a room whose rect lies inside its bedroom's. Grid cells belong to the innermost room, so walking into the en-suite logs `person.entered_room`. The bedroom's floor area excludes it. The validator allows only an en-suite inside a room, only inside a bedroom, and requires exactly one en-suite, with a WC point, per bedroom.

**Toilets:** each en-suite has a WC point (`Room1.WC` … `Room6.WC`) and, beside it, a standing work point (`Room1.WC.Stand` …). Only residents use the WC seat; anyone else sent to a WC (a carer helping, restocking) stands there, and the validator requires one per WC. The Lounge has no WC: residents there use their own en-suite.

## Walls and doors

- **Walls** are line segments along room edges (outer boundary plus internal walls). Doors are gaps on a wall; the renderer draws the wall minus its door gaps.
- **Doors** have an id, the wall they sit on, the gap (x1, y1, x2, y2) and the two rooms they connect. All doors are 1 m wide except the waiting-area opening (2 m) and the Lounge door (`D_Lounge`, 1.5 m, for zimmer frames and wheelchairs). Door state (open / locked) is not modelled in Phase 1: all internal doors are open; the exit door is where people enter and leave the map.
- `ExitDoor` connects Reception to `Outside`. `Outside` is not a room; it is where off-map people are.

## Furniture

Furniture is a labelled rectangle of kind `bed`, `desk`, `table`, `chair`, `armchair`, `sofa`, `wc`, `tv` or `bookshelf`.

- `bed`, `desk`, `table`, `sofa`, `tv` and `bookshelf` **block** movement.
- `chair`, `armchair` and `wc` do **not** block. Residents and visitors sit on seat and chair points; only residents sit on a WC. Staff sit in the staff room and at reception (breaks, handovers, reception and office work), and in a free seat beside a resident they're sitting with; anywhere else they stand. Staff never use a WC seat.
- **Bedside seating (checked by the validator):** a resident who sits out in their room has a bedside chair (point `<bed>.Chair` and furniture `<bed>.chair`); a hoisted wheelchair user has a `<bed>.Wheelchair` point instead, with no chair and no furniture other than their bed within 1 m of it; a bed-bound resident has neither.
- Furniture ids use a lowercase suffix (`Room1.Bed.bed`, `WaitingArea.chair3`, `Lounge.tv`) so they never clash with named point ids.
- **Clear widths:** the walking grid is 0.5 m, so openings are whole cells. Where a real doorway is narrower, the door records it as `clear_width_m` (the en-suite doors: 0.9 m). The validator requires it to be at least 0.8 m (wheelchair and hoist) and to fit the opening.
- **Bed clearance:** the validator requires at least 1.2 m of clear floor either side of every bed, along its length, for two carers.
- **Doorways never touch:** the validator rejects two doors whose doorway cells are neighbours (even diagonally). Doorway cells are single-occupancy, so touching doorways could leave two people each holding one and waiting for the other for ever. That happened when the en-suite doors were first placed next to the bedroom doors, which is why each bedroom door sits at the far corner.
- The Lounge has a TV on the east wall with four armchairs facing it, a 2.5 m dining table with six chairs, a bookshelf with a reading chair, and an activity table with four chairs.

## Named points

Named points are where people go and where interactions happen. Each point has an id, a room and a position.

| Pattern | Meaning |
|---|---|
| `Room1.Bed` | Where the resident lies (bed centre; reached only via "get into bed") |
| `Room1.Bed.Side` | Main bedside standing spot (care, meds, checks, visitors) |
| `Room1.Bed.Side2` | Opposite side of the bed (second carer for two-person tasks) |
| `Room1.Bed.Chair` | Bedside chair: only for residents who sit out in their room (Peggy, Win, Arthur, Stan), for sitting up and meals. There are no visitor chairs; visitors stand at the bedside |
| `Room3.Bed.Wheelchair` | Raj's wheelchair spot by his bed (kind `wheelchair`): where he's hoisted to and sits in his own wheelchair. No chair there, clear floor around it for the hoist and wheelchair, and nobody else uses it. Dennis (bed-bound) has no bedside seat |
| `Room1.WC` … `Room6.WC` | En-suite toilet (residents only) |
| `Room1.WC.Stand` … `Room6.WC.Stand` | Standing work point beside each toilet (staff) |
| `Corridor.West`, `Corridor.Mid`, `Corridor.East` | Corridor waypoints |
| `WaitingArea.Seat1`–`Seat8` | Waiting-area seats (visitors only) |
| `Lounge.Armchair1`–`4` | Armchairs facing the TV (and for dozing at nap time) |
| `Lounge.Dining1`–`6` | Dining chairs (lunch in the Lounge) |
| `Lounge.Reading` | Reading chair by the bookshelf |
| `Lounge.Activity1`–`4` | Activity-table chairs (puzzles) |
| `Lounge.Post` | Where a carer keeps an eye on the Lounge, and Bev's base and session spot |
| `Reception.Desk` | Visitor sign-in spot (in front of the desk) |
| `Reception.DeskStaff` | Receptionist's seat |
| `Reception.Office` | Wing manager's office desk (a corner of reception; no separate office room) |
| `StaffRoom.Seat1`–`Seat6` | Handover and break seats |
| `ExitDoor` | Just inside the exit; where people appear from and leave to `Outside` |

## Navigation grid

- A hidden grid of 0.5 m cells (53 × 26) is derived from the floor plan at load time.
- A cell is walkable if its centre is inside a room and not inside blocking furniture.
- Walls lie on cell boundaries. A move between two cells is blocked if it crosses a wall segment, unless it crosses inside a door gap. Diagonal moves are allowed only when both orthogonal moves are allowed (no corner-cutting).
- **Doorway cells** are the cells on either side of a door gap. They are single-occupancy: a person waits (event `person.waited_at_door`) until the doorway is clear. Pathfinding details are in [04](04-agents-and-behaviour.md).

## People (engine state)

Every person has:

- **Identity:** id (`res_`, `stf_`, `vis_`, `agy_` for generated agency staff, `ext_` for off-map responders), kind, persona reference.
- **Location:** `onMap` flag, position (x, y in metres), current room id, current path and speed (m/s).
- **Activity:** a posture (`standing`, `walking`, `sitting`, `dozing` (asleep in a Lounge armchair), `in_bed`, `on_floor`) and the current task or behaviour-tree node.
- **Needs** (residents), or **workload** and a shift assignment (staff), or a visit plan (visitors). See [04](04-agents-and-behaviour.md).
- **Badges:** short derived labels for the UI (pill, tray, towel, asleep, alert while on the floor after a fall, obs during post-fall observations).

## Off-map people

People not on the map (off-shift staff, off-site family, the on-call RN, the off-map second carer, paramedics) exist as records with `onMap: false`. They enter and leave through `ExitDoor`, which emits `person.arrived` / `person.departed` events. A resident conveyed to hospital is off-map with location `hospital`; their bed shows "in hospital".
