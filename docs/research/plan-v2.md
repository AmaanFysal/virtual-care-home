# Virtual Care Home: Technical and Design Plan (v2, simple 2D)

Sep 28, 2026 · Amaan Fysal

## TL;DR

Build a hybrid simulation with deliberately simple 2D visuals. Version 2 of this plan drops sprites, tilemaps and animation work: rooms are labelled rectangles and people are coloured circles, so the effort goes into behaviour instead.

- **Architecture:** a server-side Node/TypeScript sim with a simulation clock (pause to 360x). Utility AI, schedules and behaviour trees drive routine behaviour. Claude (Haiku 4.5 for most calls, Sonnet 5 for plans and reflections) is called only when something salient happens. Every LLM output goes into an event log, so runs replay without calling the API again.
- **Visuals:** a browser canvas drawn with PixiJS (or plain HTML canvas) inside a React control dashboard, connected over WebSockets. Simple shapes, smooth movement, clickable people.
- **Realism:** grounded in real UK care practice. No fixed staffing ratio, 24/7 rotas with handovers, open visiting under CQC Regulation 9A, and research base rates for falls, dementia, deaths and medication errors. A "director" component turns those rates into scenarios.
- **Cost:** roughly $2 to $5 per simulated day in LLM calls (my estimate, to be measured).
- **Build plan:** about 10 to 13 weeks solo, down from 14 to 18. The first 3 to 4 weeks produce a rules-only MVP you can already watch and control.

## Key findings

1. **Real care homes are rota-driven, task-dense and interrupted.** Most of the day follows a predictable skeleton (personal care, meals, medication rounds, checks). The drama comes from interruptions: a fall during the morning round, a distressed resident at dusk, a family member at reception. Model the skeleton deterministically and the interruptions stochastically.
2. **UK regulation gives staff concrete obligations.** CQC sets no staff-to-resident ratio but expects a justified dependency assessment. Visiting is a regulated right. Deaths and serious incidents trigger statutory notifications "without delay". These become checkable tasks for staff agents.
3. **Pure LLM agents are too expensive for a live 40-person world.** The Stanford Generative Agents authors reported that 25 agents over two game days cost thousands of dollars in tokens and took days to run. Event-driven LLM calls on top of rules cut that by orders of magnitude.
4. **Nothing off the shelf fits exactly.** AI Town (a16z) is the closest reference but is built for chat, not care routines, and is tied to Convex. Mesa is a research tool for grid models and batch runs, not a live control view. Borrow ideas from both, build your own engine.
5. **Dementia must shape the agent's mind, not just its label.** About 70% of care home residents in England have dementia or severe memory problems (Alzheimer's Society). Most residents need altered memory recall, not a "confused" tag in a prompt.
6. **Simple visuals are enough.** Everything that makes the sim useful (seeing who is where, pausing, inspecting a mind, injecting events) works with shapes and icons. Realistic art adds weeks and no insight.

## How a real UK care home wing runs

The sim copies how English care homes actually operate, so staff agents have real rules to follow and break.

### Regulation (England)

- **Staffing.** No prescribed ratio. Regulation 18 of the 2014 Regulated Activities Regulations requires "sufficient numbers" of suitably skilled staff, set via a dependency tool. A home with nursing needs a registered nurse on duty at all times.
- **Visiting.** Regulation 9A (in force 6 April 2024) says residents must be facilitated to receive visits unless there are exceptional circumstances. In the sim, visitors can arrive any time; protected mealtimes and personal care create soft friction.
- **Notifications.** CQC must be told "without delay" of a death (Regulation 16) and of serious injuries, abuse allegations, police incidents and events that threaten safe running (Regulation 18). The wing manager agent gets a "notify CQC" task when these fire.
- **Safeguarding.** Section 42 of the Care Act 2014 requires local authority enquiries into suspected abuse or neglect. Neglect or omission is the most common type in nursing homes, so most safeguarding scenarios should be missed care, not dramatic abuse.

### Workforce context

| Measure | Figure | Source |
| --- | --- | --- |
| Vacancy rate 2025/26 | 6.2% | Skills for Care |
| Care worker turnover | 28.5% | Recruiter summary of Skills for Care report |
| Indirect staff (bank, agency) | 9% | Skills for Care |
| Median care worker pay, March 2025 | £12.00/hour | King's Fund |

Care workers were removed from the Health and Care Worker visa route in July 2025, so the staff mix can include long-serving international staff and newer domestic recruits.

### Wing rota

| Shift | Hours | On the floor |
| --- | --- | --- |
| Early | 07:00 to 14:30 | 1 senior carer + 1 care assistant, RN for meds and clinical tasks |
| Late | 14:00 to 21:30 | 1 senior carer or experienced CA + 1 CA |
| Night | 21:15 to 07:15 | 1 waking night CA, RN and second carer on call off-map |
| Office | 09:00 to 17:00 Mon to Fri | Manager, receptionist, activities coordinator (4 days) |

The 30-minute overlaps are handovers in the staff room. Handovers are a key LLM moment, because information passes (or gets lost) between agents.

### The 10 staff

| Name, age | Role | Pattern | Persona hooks |
| --- | --- | --- | --- |
| Joanne Price, 52 | Wing manager | Office, on call | 25 years in care, protective of CQC rating, clashes with Dave over rotas |
| Maria Santos, 41 | Registered nurse | Long days | Filipino, 15 years qualified, leads end-of-life care |
| Blessing Mensah, 38 | Senior carer | Earlies | Ghanaian, Peggy's favourite, close to Kasia |
| Dave Collins, 47 | Senior carer | Lates, some nights | Ex-army, blunt, great with Stan, hates paperwork |
| Kasia Nowak, 34 | Care assistant | Earlies, lates | Polish, fast and thorough, single mum so avoids nights |
| Aisha Rahman, 23 | Care assistant | Mixed | Nursing apprenticeship, mentors Tom, anxious about mistakes |
| Tom Fletcher, 19 | Care assistant | Mixed | 3 months in, Care Certificate, sick on some Mondays |
| Florin Popescu, 45 | Care assistant | Nights only | Romanian, knows every resident's sleep pattern |
| Bev Harris, 58 | Activities coordinator | 4 days | Ex-drama teacher, runs music and reminiscence |
| Sanjay Mehta, 30 | Receptionist | Weekdays | Signs visitors in, absorbs complaints, knows the gossip |

Ten people cannot cover 24/7 alone. The gaps drive "short staffing" and "agency cover" events, with temporary agency agents who don't know residents' preferences.

### Daily routine skeleton

- **Waking and personal care (06:30 to 10:00):** staggered by preference.
- **Medication rounds:** morning, lunchtime, teatime, bedtime, plus as-needed doses. The CHUMS study found 69.5% of residents had at least one medication error, with frequent interruptions on the morning round. Model rounds as interruptible tasks whose error chance rises with interruptions.
- **Meals:** breakfast, mid-morning drinks, lunch (main meal), afternoon tea, supper, late drink. Fluid and food charting for at-risk residents.
- **Activities:** late morning or early afternoon.
- **Visitors:** peak mid-afternoon and early evening.
- **Night:** bedtimes from 19:30 to 23:00, then checks at care-plan intervals and 2 to 4 hourly repositioning for bed-bound residents.

### Base rates for the scenario director

| Event | Evidence | For 6 residents |
| --- | --- | --- |
| Falls | 1,249 per 1,000 residents per year; mostly indoors, peak in the morning | About 7 to 8 falls a sim year |
| Dementia | About 70% of residents (Alzheimer's Society) | 4 of 6 residents |
| Sundowning | Wide range by definition, up to about 80% in residential settings (Dementia UK) | Common but variable; add a midday peak too |
| Death | 26.2% died within a year (England and Wales cohort) | 1 to 2 deaths a sim year |
| Medication errors | 69.5% had at least one (CHUMS) | Occasional missed or late doses |
| Norovirus outbreak | 2+ similar cases within 48 hours; restrict visiting | Winter event reshaping routines |
| Loneliness | Severe loneliness 22% to 42% | 1 to 2 residents with few visitors |

### Scenario catalogue

Each scenario is a director card: trigger conditions, base rate, agents involved, the correct process, and failure modes.

- **Clinical:** unwitnessed fall (don't lift before assessment, RN checks, family called, notify if serious); sundowning and exit-seeking; refusal of care by a resident with capacity; missed or refused medication; hospital transfer and return with reduced mobility; GP visit; end-of-life care over weeks; death, bereavement and the empty bed; Friday-afternoon admission with missing paperwork; norovirus outbreak.
- **Staffing:** sick call at 06:15; agency carer who doesn't know Raj needs two people for the hoist; rota rows; night fatigue after 04:00.
- **Family:** complaint about wrong clothes; siblings disagreeing on DNACPR; second wife and ex-wife both visiting on a birthday; a resident with no visitors for weeks; children running, unsuitable food, filming care; financial abuse concern or unexplained bruising.
- **Joyful:** birthdays, Vaisakhi, Christmas, hairdresser day, music sessions, new friendships between residents.

### Sample 24 hours (a Tuesday in November)

| Time | What happens |
| --- | --- |
| 00:00 to 06:00 | Florin on nights. Dennis repositioned 2-hourly. 02:10 Stan sees "a dog under the bed"; Florin reassures him. 03:30 Peggy needs a pad change. |
| 07:00 | Handover: Florin briefs Blessing and Kasia on Stan, Dennis's low fluids, Peggy's bad night. |
| 07:30 to 10:00 | Personal care. Raj's hoist ties up both carers for 25 minutes. 07:50 Peggy falls walking without her frame; Maria leaves the med round. |
| 09:00 | Joanne reviews the fall (recorded, not notifiable) and fixes Thursday's rota gap. |
| 10:30 | Bev runs reminiscence with old London photos. |
| 11:15 | GP round: Dennis's anticipatory medicines prescribed. |
| 12:15 to 13:30 | Lunch. Kuldip brings homemade food for Raj; staff check his diet plan. |
| 14:00 | Early-to-late handover. Dave and Aisha take over. |
| 14:30 to 16:30 | Peak visiting. Linda sees Peggy's bruise and wants the incident form. Arthur has no one; Bev does a crossword with him. |
| 16:30 to 18:00 | Stan sundowns and tries the exit; Dave walks him through it. Peggy asks for her late husband. |
| 18:30 to 20:00 | Tunde and Funmi argue in the corridor about hospital for Win. |
| 19:30 to 22:30 | Staggered bedtimes. Sarah asks to stay overnight with Dennis. |
| 21:15 | Late-to-night handover. Florin takes over. |

## Agent architecture

Use three layers: rules for bodies, Claude for minds, and a director for events. This is unchanged from v1.

| Approach | Strengths | Weaknesses | Use it for |
| --- | --- | --- | --- |
| Finite state machines | Simple, cheap | Brittle at scale | Door, bed and room states |
| Behaviour trees | Modular, readable, testable | Hand-authored | Care procedures (hoist, fall response, med round) |
| Utility AI (Sims-style needs) | Organic, personality via curves | Needs tuning | Moment-to-moment choices: toilet, tea, rest, wander |
| GOAP / HTN planners | Chains actions to goals | Search cost grows | Staff task planning (optional) |
| LLM generative agents | Believable dialogue, emergent social behaviour | Cost, latency, drift, bias | Conversations, reactions, reflection, family dynamics |

### The three layers

1. **Body layer (deterministic, every tick, no LLM).** Rota engine, needs with utility curves (hunger, thirst, toileting, fatigue, pain, social; for staff, workload and stress), behaviour trees for care procedures, and movement. Care rules live here, for example "Raj transfer needs 2 staff" and "don't move a fallen resident before assessment".
2. **Mind layer (LLM, event-driven).** A memory stream per agent scored on importance, recency and relevance, a daily plan, a nightly reflection, and dialogue when triggered. The LLM picks among legal actions offered by the body layer or writes dialogue. It never moves agents or edits the world directly.
3. **Director layer.** Samples events from the base-rate table, adjusts for context (morning falls, winter infections, dusk agitation), paces drama, and is your manual injection point.

**LLM triggers:** a conversation starts; a salient observation (fall, raised voices, death, complaint); a plan breaks (short staffing); a handover; end-of-day reflection; you click "what are you thinking?". Everything else runs on rules.

### Dementia-aware memory

For residents with dementia, change how memories are recalled:

- Down-weight recent memories and boost long-ago ones (Peggy lives in 1972 at dusk).
- Add time-of-day confusion that grows after 16:00 for sundowners.
- Sometimes attach the wrong name to a face.
- Store new events weakly so they fade within hours.

Residents with capacity, like Arthur, get full memory.

### Cost and latency

Anthropic list prices per million tokens: Haiku 4.5 $1 in / $5 out, Sonnet 5 $2 / $10. Cache reads cost 0.1x input; the Batch API is 50% off.

| Item | Calls per sim day | Estimated cost |
| --- | --- | --- |
| Reactions and dialogue (Haiku, cached persona prefix) | ~560 | ~$1.50 |
| Plans and reflections (Sonnet, batched overnight) | ~25 | ~$0.25 |
| Off-screen family life updates (batched) | ~25 | ~$0.05 |
| **Total** | | **about $2 to $5**, depending on chattiness |

At 60x speed a sim day takes 24 real minutes, about 23 LLM calls a minute, which is comfortable. At 360x, fall back to rules and queue non-urgent LLM work.

**Cost tricks:**

- **Tiered fidelity.** Tier A (the person you're following, key scenes): Sonnet, full memory. Tier B (others on site): Haiku, short prompts. Tier C (off-site family, off-shift staff): one batched daily update, no ticking.
- **Prompt caching.** Stable content first (world rules, map summary, persona), volatile content last.
- **Template barks.** Routine phrases ("Morning Peggy, shall we get you up?") come from a phrase library, not the LLM.
- **Recorded outputs.** Every response is keyed by input hash in the event log, so replays are free.
- **Structured outputs.** JSON with action ID, utterance, emotion change and memory importance, validated against a schema.
- **Budget governor.** At 80% of the daily token budget, demote Tier B to rules.

## Visualisation: simple 2D in the browser

Draw the wing with plain shapes on a browser canvas, using PixiJS inside a React app. Visual realism is not a goal; readability is.

### What it looks like

- **Rooms:** labelled rectangles with wall lines and door gaps (Room 1, Room 2, Corridor, Staff Room, Reception, Waiting Area).
- **Furniture:** beds as small grey boxes, chairs as squares. Furniture only blocks movement and marks interaction points.
- **People:** coloured circles with initials. Blue for staff, green for residents, orange for visitors, grey for agency staff.
- **State:** a small icon or text badge above each head (pill, tray, towel, "confused", "asleep"), a speech bubble for dialogue, and a red ring for alerts like a fall.
- **Movement:** circles glide smoothly between points. No walking animations. Frail residents move slower (about 0.3 to 0.5 m/s versus staff at about 1.2 m/s).
- **Night:** dim the canvas and show night lights in the corridor.

### Why PixiJS

| Option | Verdict | Notes |
| --- | --- | --- |
| **PixiJS + React (recommended)** | Best fit | Fast 2D drawing, easy click handling, works well with React. AI Town uses it. |
| Plain HTML canvas | Fine for a first spike | Zero dependencies, but you hand-write hit-testing and redraw logic. |
| Phaser 3 + Tiled | Overkill now | Its strengths (tilemaps, sprites, animation) are what we've dropped. |
| Three.js / Unity / Godot | Not needed | 3D and engine work add weeks with no benefit for this version. |

### Map and movement

- Define the floor plan as a JSON file: rooms as rectangles, walls, doors, and named points (Room1.BedA, Room2.BedC, StaffRoom.Table, Reception.Desk, ExitDoor). No map editor needed.
- Overlay a hidden grid (about 0.5 m cells) for pathfinding with A* (easystar.js or pathfinding.js). Add a wait rule at doorways so people don't pass through each other.
- Pathfinding runs on the server; the browser only animates positions it receives.

### Control dashboard (React panels around the canvas)

- **Clock:** pause, step, 1x, 10x, 60x, 360x, jump to time.
- **Follow:** click a person and the camera tracks them.
- **Inspector:** persona card, needs bars, current task, today's plan, recent memories with importance scores, relationships, last LLM prompt and response.
- **Thoughts toggle:** inner monologue bubbles for one person or everyone.
- **Event injector:** scenario cards (fall, sundowning, norovirus, sick call, agency carer, complaint, death, admission, family dispute, birthday) with target, time and severity.
- **Timeline:** filtered event log, replay scrubber, and "branch from here" for what-if runs.
- **Metrics:** staff workload, call response times, missed tasks, LLM tokens and cost per sim day.

Because the renderer only draws positions and badges from server state, you can swap in nicer graphics (sprites, or even 3D) later without touching the simulation.

## Backend architecture

Run a server-authoritative, event-sourced simulation with a single writer per world. The browser never decides anything; it draws what the server says.

```
+--------------------------------------------------------------+
|  Browser: React dashboard + PixiJS canvas                    |
|  Draws positions and badges; sends pause, speed, inspect,    |
|  inject                                                      |
+--------------------------------------------------------------+
                  ^  WebSocket: state deltas down,
                  v  commands up
+--------------------------------------------------------------+
|  Node server (TypeScript)                                    |
|                                                              |
|  +---------------------------+    +------------------------+ |
|  | Sim engine                |<-->| LLM workers (job queue)| |
|  | Clock, rota, needs,       |    | Event-driven mind calls| |
|  | behaviour trees           |    | Results return as      | |
|  | Director, pathfinding,    |    | timed inputs           | |
|  | event bus                 |    |                        | |
|  +---------------------------+    +------------------------+ |
+--------------------------------------------------------------+
        ^              ^                         ^
        v              v                         v
+----------------+ +-----------------+ +------------------------+
| Postgres +     | | S3              | | Claude API             |
| pgvector       | | World snapshots | | Haiku 4.5, Sonnet 5,   |
| Event log,     | |                 | | Batch overnight        |
| memories,      | |                 | |                        |
| personas       | |                 | |                        |
+----------------+ +-----------------+ +------------------------+
```

The sim engine owns all state. LLM results come back as timed inputs, so the world stays consistent and every run can be replayed.

- **Sim engine (Node + TypeScript).** Fixed tick (1 sim minute per tick at 1x). Entity-component state: position, needs, schedule, care profile, memory reference, relationships. Systems run in order each tick: rota, director, needs decay, decisions, behaviour trees, movement, interactions, mind triggers. A seeded random generator makes runs reproducible.
- **LLM workers.** A job queue (BullMQ on Redis, or in-process for the MVP) calling Claude via the Anthropic API or Amazon Bedrock.
- **Event log.** Append-only Postgres table of every input, event and LLM response. It is the source of truth for replay, analytics and future integrations.
- **Snapshots.** World state saved every N sim minutes to Postgres or S3, for fast restore and branching.
- **Memory store.** Postgres with pgvector for memory embeddings, plus an importance and recency index.
- **Real-time updates.** WebSockets push compact deltas (positions, state changes, events) at 5 to 10 Hz and a full snapshot on connect. Commands flow back as typed messages. A shared TypeScript types package serves both ends.
- **REST API (Fastify).** Personas, scenario library, runs and exports.
- **Hosting.** Local first, then one AWS ECS Fargate service or EC2 box with RDS Postgres and S3. API keys in Secrets Manager.

### Testability

- **Deterministic mode:** fixed seed plus a recorded or mock LLM provider, so CI runs are free and repeatable.
- **Golden scenario tests:** for example, a fall at 06:40 means the RN attends within 10 sim minutes, the resident isn't moved before assessment, the family is called and an incident is logged.
- **Invariants every tick:** at least one staff member on the floor; no resident unchecked beyond their care-plan interval; no two-person transfer done by one; visitors never in the staff room.
- **LLM evals:** a small rubric scored by a judge model: in character, consistent with dementia level, no clinical nonsense, respectful.

### Built to extend later

Every state change is a typed event on an internal bus with a `source` field (engine, director, user, llm, external). A future module (sensors or anything else) becomes an adapter that subscribes to events and publishes its own inputs. Nothing else needs building now.

## Personas and families

Generate people in layers: a deterministic family skeleton first, then LLM-written personality and history, then validation and a human read-through.

### Pipeline

1. **Seed constraints (code).** London demographics, the 6 residents' conditions from the base-rate table, 25 visitor slots split across families.
2. **Family tree skeleton (code).** People and relationships with hard rules: parents 18 to 45 years older than children, dated marriages and divorces, deaths before admission, surnames.
3. **Narrative fill (LLM with a JSON schema).** Personalities, life stories, speech styles, habits, secrets and grievances, with the skeleton passed in as fixed facts.
4. **Shared memories.** For each strong relationship, 2 to 5 shared memories written from both sides (Linda remembers the 1987 Margate holiday fondly; Gary remembers the row on the drive home).
5. **Validators (code).** Date arithmetic, symmetric relationships, care needs consistent with conditions, consistent culture and faith across relatives, unique names.
6. **Human review.** Read every resident card once and fix caricatures.
7. **Freeze and version.** Persona set v1 is immutable; runs reference a version.

### Example: resident

```json
{
  "id": "res_peggy",
  "name": {"first": "Margaret", "known_as": "Peggy", "last": "Holloway"},
  "dob": "1937-03-14",
  "room": "Room1.BedA",
  "life_story": ["School dinner lady 1962-1997", "Married Ron 1958, widowed 2016", "Loved dancing at the Palais"],
  "personality": {"extraversion": 0.8, "agreeableness": 0.7, "neuroticism": 0.6},
  "speech_style": "Cockney, calls everyone 'love', repeats questions",
  "cognition": {"diagnosis": "Alzheimer's disease", "stage": "moderate", "memory_profile": {"recent_retention_hours": 2, "time_anchor_at_dusk": 1972, "misidentification_rate": 0.15}, "sundowning": {"onset": "16:00", "severity": 0.6}},
  "mobility": {"aid": "zimmer frame", "falls_risk": "high", "walk_speed_mps": 0.4},
  "nutrition": {"fluids_target_ml": 1500, "likes": ["tea, 3 sugars", "custard creams"]},
  "routine": {"wake": "07:30", "bed": "21:00", "nap": "14:00"},
  "legal": {"dnacpr": false, "lpa_health": "Linda", "dols": "granted 2026-01"},
  "staff_relationships": [{"staff": "stf_blessing", "trust": 0.9}],
  "goals": ["find Ron", "go home to feed the cat"],
  "triggers": ["loud voices", "men in the room at night"]
}
```

### Example: visitor

```json
{
  "id": "vis_linda",
  "name": "Linda Carter", "age": 62,
  "relation_to_resident": [{"resident": "res_peggy", "type": "daughter"}],
  "emotional_state": {"guilt": 0.8, "grief_anticipatory": 0.6, "trust_in_home": 0.5},
  "visit_pattern": {"days": ["Mon","Tue","Wed","Thu","Sat"], "time_window": "14:00-16:00", "reliability": 0.85},
  "visit_behaviours": ["brings custard creams", "checks the clothes labels", "asks for the fluid chart"],
  "conflicts": [{"with": "vis_gary", "issue": "he doesn't visit, she does everything", "intensity": 0.7}],
  "offscreen_life_hooks": ["husband Mick's redundancy", "her own knee operation in spring"]
}
```

### Example: staff

```json
{
  "id": "stf_dave",
  "name": "Dave Collins", "age": 47, "role": "senior_carer",
  "competencies": ["meds_trained", "moving_handling_trainer", "dementia_level2"],
  "contract": {"hours_per_week": 37.5, "patterns": ["late", "night"], "sickness_propensity": 0.03},
  "stress": {"baseline": 0.4, "rises_with": ["paperwork", "short staffing"]},
  "care_style": "practical, calm under pressure, blunt with families",
  "relationships": [{"with": "stf_joanne", "tension": 0.6}, {"with": "res_stan", "rapport": 0.9}]
}
```

### Example: relationship edge

```json
{"from": "vis_funmi", "to": "vis_tunde", "type": "sibling", "closeness": 0.5, "tension": 0.8,
 "history": ["Tunde moved to Manchester in 2004", "Funmi was Mum's main carer 2019-2025"],
 "live_issues": ["DNACPR decision for Mum", "selling Mum's flat"]}
```

### The cast

| Resident | Room | Profile | Family and visitors |
| --- | --- | --- | --- |
| Peggy Holloway, 89 | 1 | Moderate Alzheimer's, high falls risk, sundowns | Linda (daughter), Mick (son-in-law), Gary (son, in Spain), Chloe (granddaughter, student nurse) |
| Win Adeyemi, 84 | 1 | Retired NHS midwife, mild vascular dementia, heart failure, diabetes, Pentecostal | Funmi (daughter), Tunde (son), Kayode (grandson), Sister Grace (church friend) |
| Arthur Pemberton, 91 | 2 | Ex-RAF engineer, full capacity, Parkinson's, lonely | Colin (nephew), Bernard (RAF friend), Hannah (befriender) |
| Raj Sandhu, 79 | 2 | Retired bus driver, stroke with aphasia, 2-person hoist | Kuldip (wife), Harpreet (son), Simran (daughter-in-law), Arjun and Priya (grandchildren) |
| Stan Brooks, 82 | 2 | Former market trader, Lewy body dementia, hallucinations, night wandering | Maureen (second wife), Tracey (daughter), Sheila (ex-wife), Terry (old mate) |
| Dennis Hart, 87 | 2 | Advanced dementia, bed-bound, end of life | Sarah (daughter), Paul (son), Mia (granddaughter), Pat (sister), Father Michael |

That is 25 visitors. Visits are sampled from each person's pattern with mood and reliability modifiers, so a normal afternoon has 3 to 8 on site. Room 1 is female and Room 2 male, for dignity and plausibility.

## Recommendations

Go with TypeScript end to end, simple 2D visuals, and a rules-first build. Expect about 10 to 13 weeks solo.

### Final stack

| Layer | Choice |
| --- | --- |
| Repo | pnpm monorepo: `sim-engine`, `server`, `web`, `shared-types`, `persona-gen` |
| Frontend | React + Vite, PixiJS (via @pixi/react) for the canvas, Zustand for dashboard state, Recharts for metrics |
| Map | Hand-written JSON floor plan with named points, hidden grid for A* |
| Backend | Node.js + Fastify, ws WebSockets, BullMQ + Redis for LLM jobs |
| Storage | Postgres + pgvector, S3 for snapshots |
| LLM | Claude Haiku 4.5 by default, Sonnet 5 for plans, reflections and key scenes, Batch API overnight |
| Testing | Vitest, seeded RNG, recorded-LLM provider, golden scenario tests |
| Deploy | Docker, then AWS ECS Fargate + RDS + S3 |

### Revised roadmap

| Phase | Scope | Effort |
| --- | --- | --- |
| 0. Design | JSON floor plan, rota, care rules, persona skeletons, event schema | 1 week |
| 1. Rules-only MVP | Tick engine, clock controls, rota and handovers, needs + utility AI, 5 core behaviour trees, A* movement, shapes-and-badges canvas, follow and inspector, event log | 2 to 3 weeks |
| 2. Minds | Memory stream, dementia-aware recall, LLM dialogue and thoughts, daily plans and reflections, tiered fidelity, caching, budget governor, cost meter | 3 to 4 weeks |
| 3. Director and scenarios | Base-rate director, 15 to 20 scenario cards, injection UI, CQC notification tasks, golden tests | 2 to 3 weeks |
| 4. Living families | Full 25-person visitor pool, off-screen life updates, relationships over weeks, snapshots, replay, branch-from-here | 2 weeks |
| 5. Optional | Nicer graphics, analytics, headless batch runs to calibrate rates, more wings, plug-in adapters | Ongoing |

The saving versus v1 (14 to 18 weeks) comes from dropping tilemaps, sprites and animation, and from a simpler renderer.

### What to do first

Write the floor plan JSON, the rota, and five behaviour trees (morning personal care, med round, meal service, fall response, night check) before touching the LLM. If the world is believable with rules and coloured circles, the LLM layer only has to add voice and memory. If it isn't, no prompt will save it.

## Caveats

- **Base rates are approximate.** The falls study sampled residents aged 75+ who were not bed-bound; the mortality figure comes from an older cohort; sundowning prevalence varies hugely by definition. Treat them as tunable parameters.
- **Some workforce figures are secondary.** Turnover percentages came via a recruiter's summary of the Skills for Care report. Check the primary source before quoting externally.
- **Model names and prices change often.** Prices are from Anthropic's pricing page as of September 2026. The cost per sim day is an estimate to measure in Phase 2.
- **Shared rooms are less common in modern UK homes.** Say so in any demo.
- **The rota is simplified.** Ten staff can't cover 24/7 alone; the design assumes off-map night support and agency or bank staff.
- **LLM bias and dignity.** Generative agents inherit model biases. Review personas for stereotypes (accents, faiths, dementia played for laughs) and keep a human pass on every card.
- **Not a clinical tool.** If you use it to test real products or train staff, have a registered nurse or care manager review the behaviour trees against current NICE and CQC guidance.
