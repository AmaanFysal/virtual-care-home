# 02 · World model

**Purpose:** how the wing is represented: floor plan, rooms, doors, furniture, named points, navigation grid, and the entity/component state of people.

> Status: stub. Source: [plan-v2](research/plan-v2.md) (Map and movement), [research v1](research/compass_artifact_wf-e32da241-4ccf-5101-9b32-ad9cb38f7579_text_markdown.md) §3.

**Fixed requirement:** each room stores its **floor area (m²)** and **ceiling height (m)**. A future module will need room volumes, so these are captured now even though v1 does not use them.

## To be decided

- Floor plan JSON schema (`data/floorplan.json`): rooms as rectangles, walls, door gaps, named points (`Room1.BedA`, `StaffRoom.Table`, `Reception.Desk`, `ExitDoor`, ...).
- Coordinate system and units (metres? origin? y-down?).
- Final room list: Room 1 (2 beds, female), Room 2 (4 beds, male), Corridor, Staff Room, Reception, Waiting Area. Do we need a dining area or bathrooms (falls happen in bathrooms)?
- Navigation grid cell size (plan suggests ~0.5 m) and how it is derived from the plan.
- Door states (FSM: open / closed / locked; exit door keypad).
- Furniture: blockers only, plus interaction points (bedside, chair, doorway).
- Entity components: Position, Needs, Schedule, CareProfile, Memory ref, Relationships. Anything else?
- How off-map people are represented (night RN on call, off-shift staff, off-site family).
