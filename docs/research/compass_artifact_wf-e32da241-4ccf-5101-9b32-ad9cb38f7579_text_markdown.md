# Virtual Care Home: Technical and Design Plan for a Live Multi-Agent Simulation of One UK Care Home Wing

Build it as a hybrid simulation. Use a deterministic TypeScript sim engine for bodies, rotas, routines and movement, and put a thin, event-driven Claude layer on top for minds (dialogue, reactions, memory, reflection). Render it in a 2D top-down browser view (Phaser 3 or PixiJS with Tiled maps) inside a React control dashboard, with WebSockets between them. That gives you believable people at a running cost of a few dollars per simulated day instead of the thousands of dollars the original Stanford generative agents study spent.\[1\] It also keeps every run replayable and testable.

## TL;DR

- **Architecture:** a server-authoritative Node/TypeScript sim with a simulation clock (pause to 360x). Utility AI, schedules and behaviour trees drive routine behaviour. Claude (Haiku 4.5 for most calls, Sonnet 5 for plans and reflections) is called only when something salient happens, with persona prompts cached and every LLM output written to an event log so runs replay without re-calling the API.
- **Realism:** ground the world in real UK care practice. No fixed staffing ratio (CQC expects "sufficient numbers" set via dependency tools), 24/7 shift rotas with handovers, open visiting under CQC Regulation 9A (in force since 6 April 2024), and base rates from research: 70% of care home residents in England have dementia or severe memory problems (Alzheimer's Society), 1,249 falls per 1,000 residents per year (a 2026 UK study of about 1,700 care homes), 26.2% of residents dying within a year (Age and Ageing cohort study), and 69.5% of residents having at least one medication error (CHUMS). A "director" component turns these rates into scenarios.
- **Build plan:** about 14 to 18 weeks solo. The first 4 weeks produce a no-LLM MVP (map, rota, routines, pathfinding, pause/speed/inspect). LLM minds, memory, the scenario director, replay and branching follow. The stack is React + Phaser 3 + Tiled on the front, Node + Fastify + WebSockets + Postgres (with pgvector) on the back, Claude via the Anthropic API or Amazon Bedrock, deployed on AWS.

## Key Findings

1. **Real care homes are rota-driven, task-dense and interrupted.** Most of what staff do follows a predictable daily skeleton (personal care, meals, medication rounds, checks). The drama comes from interruptions: a fall during the morning round, a distressed resident at dusk, a family member at the nurses' station. Model the skeleton deterministically and the interruptions stochastically.
2. **UK regulation shapes behaviour in ways the sim should show.** CQC does not set a staff-to-resident ratio. Providers must justify staffing with a dependency assessment.\[2\] Visiting is a regulated right, not a courtesy.\[3\] Deaths and serious incidents trigger statutory notifications "without delay".\[4\]\[5\] These rules give staff agents concrete, checkable obligations.
3. **Pure LLM agents are too expensive and too slow for a live 40-person world.** The Stanford paper's authors reported that simulating 25 agents for two game days cost "thousands of dollars in token credits and taking multiple days to complete".\[1\] A later paper (Lyfe Agents) worked that out as US$25 per agent per human hour in real-time use. The Lyfe Agents authors report that their techniques ran at a cost "10-100 times lower than existing alternatives".
4. **Nothing off the shelf fits exactly.** AI Town (a16z) is the closest reference: a MIT-licensed, Convex-based engine with a PixiJS front end. Its conversations "currently have exactly two members", and it is built for chat, not care routines.\[6\] Mesa is a mature Python agent-based modelling framework, but it is aimed at research-style grid models, not a game-like live view.\[7\] Borrow ideas from both, but build your own engine.
5. **Dementia must shape the agent's mind, not just its label.** The Alzheimer's Society estimates that 70% of people in care homes in England have dementia or severe memory problems. So most residents need altered memory retrieval (time disorientation, older memories surfacing, confabulation), not just a "confused" tag in a prompt.

## Details

### 1. How a real UK care home wing runs

#### Regulatory frame (England)

- **Staffing.** There is no prescribed ratio. Regulation 18 of the Health and Social Care Act 2008 (Regulated Activities) Regulations 2014 requires "sufficient numbers of suitably qualified, competent, skilled and experienced persons".\[8\] CQC expects providers to use a dependency tool, review it when needs change, and show the layout was considered.\[2\] A care home "with nursing" must have a registered nurse on duty at all times.\[9\]
- **Visiting.** Regulation 9A (in force 6 April 2024) says that, unless there are exceptional circumstances, residents must be facilitated to receive visits and must not be discouraged from going out with visitors.\[3\] Commentators note it "appears to signal an end to visiting times".\[10\] DHSC published a post-implementation review on 18 March 2026.\[11\] In the sim, visitors can arrive at any hour, while protected mealtimes and personal care create soft friction.
- **Notifications (CQC Registration Regulations 2009).**
  - Regulation 16: the provider must notify CQC "without delay" of a resident's death while regulated activity was being provided.\[4\]
  - Regulation 18: covers serious injuries, injuries needing treatment by a health professional, "any abuse or allegation of abuse", police incidents, and events that threaten safe running. Examples of the last are insufficient qualified staff, or loss of power, gas or water for more than 24 continuous hours.\[5\]
  - Under Regulation 18(5)(g), "prolonged" means lasting, or likely to last, at least 28 continuous days.\[5\] CQC's guidance counts a new grade 3 or above pressure sore as a qualifying injury.\[12\]
  - DoLS: the outcome of a Deprivation of Liberty Safeguards application must be notified "once the outcome of the request or application is known".\[5\]
  - These rules make good sim rules: the wing manager agent gets a "notify CQC" task whenever these events fire.
- **Safeguarding.** Section 42 of the Care Act 2014 requires the local authority to make enquiries when an adult with care and support needs is at risk of abuse or neglect.\[13\] In 2024/25, neglect or acts of omission made up 51.6% of concluded Section 42 enquiries in nursing homes (Nuffield Trust analysis of DHSC data).\[14\] Most safeguarding scenarios should therefore be about omission (a missed repositioning, an ignored call for help, a skipped drink round), not dramatic abuse.

#### Workforce context (for staff personas and events)

- **Vacancy.** Skills for Care reports the adult social care vacancy rate fell to 6.2% in 2025/26, the lowest since 2015/16. That is still about three times the wider economy.\[15\]
- **Turnover.** Overall turnover in the 2025 State of report was 23.1%, and 28.5% for care workers (via a recruiter's summary of the Skills for Care report).\[16\]
- **Indirect staff.** 9% of the workforce were "indirectly employed" (bank, pool or agency).\[17\]
- **Pay.** Median care worker pay in the independent sector was £12.00 an hour in March 2025 (King's Fund, citing Skills for Care).\[18\]
- **International recruitment.** Care workers and senior care workers were removed from the Health and Care Worker visa route in July 2025, so the sim's staff mix can include both long-serving international staff and newer domestic recruits.\[17\]

#### Shift patterns and handovers

UK homes run rolling 24/7 rotas of early, late, twilight and waking-night shifts, or 12-hour long days (for example 8am to 8pm with 30-minute handovers).\[19\]\[20\] Dedicated night teams are common; Newcastle City Council's night staff work 2 or 3 nights a week.\[21\] Night staff attend a handover at the start and end of each shift, and checks follow each resident's care plan.\[22\]

**Recommended wing rota for the sim:**

| Shift | Hours | On the floor (typical) |
|---|---|---|
| Early | 07:00 to 14:30 | 1 senior carer + 1 care assistant, RN attends for meds and clinical tasks |
| Late | 14:00 to 21:30 | 1 senior carer or experienced CA + 1 CA |
| Night | 21:15 to 07:15 | 1 waking night care assistant, RN and second carer on call from the main building (off-map) |
| Office | 09:00 to 17:00 Mon to Fri | Wing manager, receptionist (weekdays), activities coordinator (4 days) |

The 30-minute overlaps are handovers: staff gather in the staff room and pass on each resident's night, falls, intake, mood and family news. Handovers are a key LLM moment, because information passes (or gets lost) between agents.

#### The 10 staff

| # | Name, age | Role | Pattern | Persona hooks |
|---|---|---|---|---|
| 1 | Joanne Price, 52 | Wing (unit) manager | Office hours, on call | 25 years in care, protective of CQC rating, clashes with Dave about rotas |
| 2 | Maria Santos, 41 | Registered nurse | Long days, shared with next wing | Filipino, 15 years qualified, calm clinician, leads end-of-life care |
| 3 | Blessing Mensah, 38 | Senior carer | Earlies | Ghanaian, 10 years, Peggy's favourite, close friend of Kasia |
| 4 | Dave Collins, 47 | Senior carer | Lates and some nights | Ex-army, blunt, great with Stan's hallucinations, dislikes paperwork |
| 5 | Kasia Nowak, 34 | Care assistant | Earlies and lates | Polish, 6 years, fast and thorough, single mum so avoids nights |
| 6 | Aisha Rahman, 23 | Care assistant | Mixed | Nursing apprenticeship, mentors Tom, anxious about getting things wrong |
| 7 | Tom Fletcher, 19 | Care assistant | Mixed | 3 months in, doing the Care Certificate, sometimes calls in sick on Mondays |
| 8 | Florin Popescu, 45 | Care assistant | Nights only | Romanian, 8 years of nights, quiet, knows every resident's sleep pattern |
| 9 | Bev Harris, 58 | Activities coordinator | 4 days a week | Ex-drama teacher, runs music and reminiscence, fights for Arthur to get out |
| 10 | Sanjay Mehta, 30 | Receptionist | Weekdays 08:30 to 16:30 | Signs visitors in, first to absorb complaints, knows all family gossip |

With only 10 people, the rota leaves gaps. That is realistic and drives "short staffing" and "agency cover" events. Agency and bank carers can be spawned as temporary agents who do not know residents' preferences.

#### Daily routine skeleton

- **Waking and personal care (06:30 to 10:00):** staggered by preference. Some residents are early risers; some refuse before 9.
- **Medication rounds:** usually morning, lunchtime, teatime and bedtime, plus PRN (as-needed) doses. The Care Homes' Use of Medicines Study (CHUMS) found 69.5% of residents had at least one medication error, a mean of 1.9 errors per resident, and staff interruptions during the morning round described as "frequent" or "constant".\[23\]\[24\]\[25\] Model a med round as an interruptible task with error probability rising with interruptions.
- **Meals:** breakfast, mid-morning drinks, lunch (the main meal), afternoon tea, supper, and a late drink. Include fluid and food charting for at-risk residents.
- **Activities:** late morning or early afternoon.
- **Visitors:** peak mid-afternoon and early evening.
- **Night:** bedtime routine staggered from 19:30 to 23:00, then night checks at care-plan frequency (for example 1 to 2 hourly, with 2 to 4 hourly repositioning for bed-bound residents).

#### Base rates for the scenario director

| Event | Evidence | Sim implication for 6 residents |
|---|---|---|
| Falls | UK study of 6,006 residents with a fall: 1,249 falls per 1,000 residents per year; 98.5% indoors, mostly bedroom, lounge and bathroom; highest rate in the morning; 45% of fallers had 3+ falls\[26\]\[27\] | About 7 to 8 falls per sim year, clustered in the morning and in high-risk residents |
| Dementia | About 70% of care home residents have dementia or severe memory problems (Alzheimer's Society)\[28\] | 4 of 6 residents have dementia |
| Sundowning | Dementia UK: about 20% of people with dementia, and about 80% of people with dementia in residential settings. Research reviews give a much wider range, 2.5% to 66%\[29\]\[30\] | Make it common but variable per resident. Also model a midday peak, since one UK inpatient study found incidents peaking at "high noon" as well as sundown\[31\] |
| Death | 26.2% of care home residents died within 1 year (England and Wales cohort study)\[32\] | About 1 to 2 deaths per sim year, one end-of-life arc running at any time |
| Medication errors | CHUMS: 69.5% of residents had 1+ error\[25\] | Occasional missed or late doses, mainly on interrupted rounds |
| Infection outbreaks | Norovirus outbreak: 2+ people with similar symptoms within 48 hours. Close to admissions, discourage visiting, staff off until 48 hours symptom-free\[33\] | Winter norovirus event that locks down visiting and reshapes routines |
| Loneliness | "Severe loneliness" in care homes is reported at 22% to 42%, more than twice the community rate (Victor)\[34\] | 1 to 2 residents with few visitors and a loneliness need that staff must fill |

#### Scenario catalogue

Each scenario is a director "card": trigger conditions, a base rate, the agents involved, the expected correct process, and failure modes the sim can show.

**Clinical and care**
- **Unwitnessed fall.** Peggy found on the floor at 06:40. Do not lift until assessed. Senior calls the RN, who does a head-to-toe and neuro check. Hoist or assist up, record and do a body map, phone the daughter. 999 or 111 if injured. Regulation 18 notification if serious injury. Post-fall observations over 24 hours.
- **Sundowning and agitation.** Stan becomes convinced at 16:30 that he must "get to the market to open up". He tries the exit doors and becomes verbally aggressive. Good response: distraction, a walk, tea, reminiscence. Bad response: arguing, crowding.
- **Refusal of care.** Arthur refuses his Monday shower. He has capacity, so staff must respect it, re-offer later, record it, and escalate if hygiene risk builds.
- **Medication issues.** A missed dose because the RN was called to a fall. A resident spitting out tablets. A PRN painkiller request at 02:00.
- **Hospital transfer.** Suspected chest infection or fracture: 999 call, grab bag, a staff member or family escorts, the bed held, and the resident returns days later with new medication and reduced mobility.
- **GP visit.** A weekly practice round or ad hoc call: medication review, a family member wanting to attend, DNACPR discussion.
- **End-of-life care.** Dennis declines over 2 to 3 weeks: anticipatory medicines, mouth care, repositioning, family staying overnight, priest visit, staff emotional load.
- **Death and bereavement.** RN verifies death, doctor certifies, family attend, funeral director collects. CQC Regulation 16 notification without delay. Roommates told gently; the empty bed affects Room 2's mood; staff debrief; a new admission within weeks.
- **New admission.** Hospital discharge on a Friday afternoon with incomplete paperwork. A settling-in period, family anxiety, a higher sundowning risk from the new environment.
- **Infection outbreak.** Two residents vomiting within 48 hours. Isolation, visiting restricted, a staff member off sick for 48 hours after symptoms stop, activities cancelled, families angry.\[33\]

**Staffing**
- **Sickness.** Tom calls in sick at 06:15. The late shift is asked to stay; the manager rings the bank list, then an agency.
- **Agency cover.** An agency carer who does not know that Raj needs two people for the hoist, or that Peggy takes her tea with three sugars. Errors and family complaints follow.
- **Staff conflict.** Dave and Joanne over the rota. A handover row about who missed repositioning.
- **Fatigue.** The night carer's error rate climbs after 04:00.

**Family and visitors**
- **Complaint.** Linda finds Peggy in someone else's cardigan and demands to see the manager.
- **Family dispute.** Win's children disagree about DNACPR and whether Mum should go to hospital.
- **Conflict between visitors.** Stan's second wife and his ex-wife both turn up on his birthday.
- **Loneliness.** Arthur has no visitors for 3 weeks; Bev arranges for the befriender Hannah to come.
- **Visitor behaviour.** Children running in the corridor, a visitor bringing in food that doesn't suit a modified diet, a relative filming care on a phone, a relative who is drunk.
- **Safeguarding.** A relative takes Raj's bank card "to help with shopping" and the money pattern changes (financial abuse concern). Or unexplained bruising on Peggy's arm (body map, manager, local authority referral, CQC notification of the allegation).

**Social and joyful**
- **Birthdays:** cake, singing, family arriving in a group.
- **Celebrations:** Vaisakhi for Raj's family, Christmas, Win's church choir.
- **Other:** a hairdresser day, a music session, a new friendship forming between Win and Peggy.

#### Sample 24-hour timeline (a Tuesday in November)

| Time | What happens |
|---|---|
| 00:00 to 06:00 | Florin on nights. Checks every 1 to 2 hours; Dennis repositioned 2-hourly. 02:10: Stan up, sees "a dog under the bed" (Lewy body hallucination); Florin reassures him and walks him back. 03:30: Peggy is incontinent; pad change, fresh sheets. 05:30: Arthur awake, wants tea. |
| 06:30 | Early wake for Arthur and Raj by preference. Florin updates notes. |
| 07:00 to 07:30 | Handover in the staff room: Florin briefs Blessing and Kasia on Stan's night, Dennis's reduced fluids, and Peggy's disturbed sleep. |
| 07:30 to 10:00 | Personal care. Raj needs 2 staff with the hoist, which ties both carers up for 25 minutes. 07:50: Peggy tries to walk to the toilet alone without her frame and falls (the director fires the morning-peak fall card). The fall protocol pulls Maria off the med round. |
| 08:00 to 09:30 | Breakfast in rooms and a small dining area. Maria finishes the morning med round late; Win's diabetic check. |
| 08:30 | Sanjay opens reception. Linda phones after the fall call and is anxious. |
| 09:00 | Joanne arrives, reviews the fall, and decides whether it is a Regulation 18 notification (no serious injury, so not notifiable, but recorded). She starts the rota fix for Thursday's gap. |
| 10:30 | Mid-morning drinks. Bev runs a reminiscence session with old London photos in the waiting area. |
| 11:15 | GP practice round: Dennis's anticipatory medicines prescribed. Sarah (his daughter) joins by phone. |
| 12:15 to 13:30 | Lunch, the main meal. Protected mealtime. Kuldip arrives with homemade food for Raj; staff check it matches his diet plan. |
| 13:00 | Lunchtime meds. |
| 14:00 to 14:30 | Early-to-late handover. Dave and Aisha take over. |
| 14:30 to 16:30 | Peak visiting. Linda arrives, sees the bruise and wants the incident form. Win's church friend Sister Grace visits. Arthur has no one; Bev does a crossword with him. |
| 16:30 to 18:00 | Dusk. Stan sundowns and tries the exit; Dave walks and talks him through it. Peggy asks repeatedly for her late husband. |
| 17:00 | Teatime meds. Joanne leaves; Sanjay has already gone. The door buzzer is now answered by care staff, which adds interruptions. |
| 17:30 | Supper. |
| 18:30 to 20:00 | Evening visitors: Tunde and Funmi argue in the corridor about hospital versus staying in the home for Win. |
| 19:30 to 22:30 | Staggered bedtimes. Bedtime med round. Dennis's family says goodnight; Sarah asks to stay overnight and a recliner is found. |
| 21:15 to 21:45 | Late-to-night handover. Florin takes over. |
| 22:00 to 24:00 | Quiet corridor, night lights. Florin does checks, charts fluids, and has a short break in the staff room when the wing is settled. |

### 2. Agent architecture

#### Options compared

| Approach | Strengths | Weaknesses | Use it for |
|---|---|---|---|
| Finite state machines | Simple, cheap | Brittle, explode in size | Door, bed and room states |
| Behaviour trees | Modular, readable, testable; widely used in games\[35\] | Hand-authored, not emergent | Care procedures (hoist transfer, fall response, med round) |
| Utility AI (needs-based, as in The Sims) | Organic, personality through response curves\[36\]\[37\] | Needs tuning; can dither\[36\] | Moment-to-moment choice: toilet, tea, rest, wander, socialise |
| GOAP / HTN planners | Chains actions to goals dynamically\[35\] | Search cost grows with actions and state\[35\] | Staff task planning under constraints (optional) |
| LLM generative agents (memory stream, reflection, planning) | Believable dialogue, emergent social behaviour | Cost, latency, drift, bias, non-determinism\[1\] | Conversations, reactions, reflection, daily plans, family dynamics |

Park et al.'s architecture stores "a complete record of the agent's experiences using natural language", synthesises them "into higher-level reflections" and retrieves them "dynamically to plan behavior". Their ablation showed observation, planning and reflection each "contribute critically" to believability.\[38\] They also warn that agents "may struggle to generate believable behavior for certain subpopulations" and can show stereotypes.\[1\] That matters when simulating frail older people, people with dementia, and a multicultural London staff team.

#### Recommendation: a three-layer hybrid

1. **Body layer (deterministic, every tick, no LLM).**
   - Rota engine: who is on shift.
   - Per-agent needs with utility curves: hunger, thirst, toileting, fatigue, pain, social, comfort, and for staff, workload and stress.
   - Behaviour trees for care procedures, and navigation.
   - Encode care rules here, for example "Raj transfer requires 2 staff + hoist" and "do not move a fallen resident before assessment".
2. **Mind layer (LLM, event-driven).**
   - A memory stream per agent (observations, with importance, recency and relevance scoring as in Park et al.).
   - A daily plan at sim-day start, and a reflection at night.
   - Dialogue and "inner thoughts" when triggered.
   - The LLM chooses among legal actions returned by the body layer, or writes dialogue. It never directly moves agents or edits the world, which keeps the world consistent.
3. **Director layer.** A scenario engine that samples events from the base-rate table, adjusts for context (morning fall peak, winter infections, dusk agitation) and paces drama so the day is not a disaster every hour. It is also your manual injection point.

**Triggers for LLM calls (event-driven):**
- two or more agents start a conversation
- a salient observation above an importance threshold (fall, raised voices, a death, a complaint)
- plan invalidation (the shift runs short, so re-plan)
- handover (summarise and pass on)
- end-of-day reflection
- a user click on "what are you thinking?"

Everything else runs on rules.

**Dementia-aware memory.** For residents with dementia, change retrieval, not just the prompt:
- Down-weight recent memories and boost long-ago episodic memories (Peggy "lives" in 1972 at dusk).
- Add time-of-day confusion that grows after 16:00 for sundowners.
- Occasionally retrieve the wrong person for a face (calling Blessing by her sister's name).
- Store new events at low consolidation so they fade within hours.

Residents with capacity (Arthur) get full memory. This one design choice will do more for realism than any prompt.

#### Cost, latency and scale

Current Anthropic list prices per million tokens: Haiku 4.5 $1 input and $5 output; Sonnet 5 $2 and $10; Opus 5.5 $4 and $20. Cache reads cost 0.1x the base input price, and a 5-minute cache write costs 1.25x, so "caching pays off after one cache read".\[39\] The Batch API gives 50% off for asynchronous work.\[40\] Newer models use a tokenizer that produces "approximately 30% more tokens for the same text", so budget accordingly.\[39\]

**Rough estimate for one sim day** (my own sizing, not a published figure):

| Item | Calls | Tokens per call | Cost (Haiku 4.5) |
|---|---|---|---|
| Event-driven reactions and dialogue turns | ~560 (6 residents, ~6 on-shift staff, ~8 visitors) | ~3,000 in (2,000 cached persona prefix) + ~300 out | ~$1.50 |
| Daily plans and reflections (Sonnet 5, batched overnight) | ~25 | ~5,000 in + ~1,000 out | ~$0.25 at batch rates |
| Off-screen family "life updates" (batched) | ~25 | ~2,000 in + ~300 out | ~$0.05 |
| **Total** | | | **about $2 to $5 per sim day**, depending on how chatty you let it be |

**Latency.** At 60x speed, one sim day takes 24 real minutes, which is about 23 LLM calls per real minute. That is comfortable. At 360x (a day in 4 minutes), fall back to rules only and queue non-urgent LLM work, or pause the world clock while a key conversation resolves.

**Tricks that make it work:**
- **Tiered fidelity.**
  - Tier A: the agent you are following or inspecting, and anyone in a key scene. Uses Sonnet, full memory retrieval and richer dialogue.
  - Tier B: agents on site. Uses Haiku, short prompts.
  - Tier C: off-site family and off-shift staff. No ticking at all; one batched "what happened in your life today" update per sim day, which creates hooks like "Linda had a row with her husband, so she arrives tense".
- **Prompt caching.** Put the stable part first (world rules, the wing map summary, the persona card, relationship summary) and the volatile part (current observations, retrieved memories) last.
- **Template barks.** Greetings and routine care phrases ("Morning Peggy, shall we get you up?") come from a phrase library with persona variations. No LLM needed.
- **Recorded outputs.** Every LLM response is stored in the event log keyed by the input hash, so replay is exact and costs nothing.
- **Structured outputs.** The LLM returns JSON (chosen action ID, utterance, emotion delta, memory importance), validated against a schema.
- **Budget governor.** A per-sim-day token budget. When 80% is used, demote Tier B to rules.

### 3. Visualisation and world stack

| Option | Fit | Notes |
|---|---|---|
| **Phaser 3 + Tiled (recommended)** | Excellent | Built-in tilemaps, cameras (follow a person), tweens, sprite animation. Easystar or a navmesh plugin for pathfinding.\[41\]\[42\] Embed the canvas in React and build the dashboard in React. |
| PixiJS / @pixi/react + Tiled | Very good | AI Town uses pixi-react.\[6\] Lighter and more React-native, but you write your own camera, tilemap and animation plumbing. |
| Three.js / React Three Fiber | Later | Looks impressive, but 3D assets, animation rigs and navmeshes add weeks of work for little gain in understanding what is happening. |
| Babylon.js | Later | Similar trade-off to Three.js, more batteries included. |
| Unity / Godot | Not now | Strong engines, but split your stack away from TypeScript, and web builds with a live backend and dashboard are clumsier. |

**Open-source frameworks to borrow from:**
- **AI Town (a16z, MIT).** Study its engine design:
  - inputs go into a table with "a monotonically increasing unique input number"\[6\]
  - many 60 Hz ticks are batched into one step, run once per second\[6\]
  - a strict single-threaded per-world invariant\[6\]
  - agents "use a combination of simple rule-based systems and talking to an LLM"\[6\]

  Do not fork it: it is tied to Convex, and its conversations are two-person only.
- **Stanford Generative Agents code.** Reference for memory scoring, reflection prompts and plan decomposition.
- **Mesa (Python ABM, version 3.x stable, 4 in pre-release).** Useful later for headless batch experiments, such as running 1,000 rules-only sim weeks to calibrate fall rates.\[43\] It is not the live world.
- **Affordable Generative Agents and Lyfe Agents papers.** Cost-reduction patterns to reuse.\[44\]\[45\]

**Map and navigation.**
- Build the wing in Tiled at 32px tiles. Layers: floor, walls, doors (with state), furniture as blockers only, and object layers for named zones and interaction points.
- Named zones: Room1.BedA, Room1.BedB, Room2.BedA to D, Corridor, StaffRoom, Reception, WaitingArea, ExitDoor.
- Interaction points: bedside, chair, doorway.
- Use grid A* (easystar.js) for the MVP. Add tile costs (for example, a slower corridor during the meal trolley)\[46\]\[47\] and slow walking speeds for frail residents: frame users at about 0.3 to 0.5 m/s versus staff at about 1.2 m/s.
- Add simple local avoidance, and a "wait" rule at doorways so two people don't walk through each other.
- The pathfinding runs on the server, so the frontend only animates what it is told.

**Animations.** A small sprite set covers the MVP:
- walk (4 directions)
- sit, lie in bed
- assisted walk (staff and resident pair moving together)
- wheelchair push, hoist (a combined sprite)
- fallen

Overlay icons carry the rest: speech bubbles, thought clouds, an emotion emoji, a task icon (pill, tray, towel), and alert rings.

**Live control dashboard (React panels around the canvas):**
- Clock: pause, step one tick, 1x, 10x, 60x, 360x, jump to time.
- Follow camera: click a person, and the camera tracks them.
- Inspector:
  - persona card
  - needs bars
  - current behaviour tree node and task
  - today's plan and schedule
  - recent memories with importance scores
  - relationships (mini graph)
  - last LLM prompt and response (debug tab)
- Thoughts toggle: show inner monologue bubbles for the followed agent, or for all agents.
- Event injector: scenario cards (Fall, Sundowning, Norovirus, Sick call, Agency carer, Complaint, Death, New admission, Family dispute, Birthday), with target, time and severity.
- Timeline: an event log with filters, a scrubber for replay, and "branch from here" (restore a snapshot and run a what-if).
- Metrics: staff workload, call response times, missed tasks, LLM tokens and cost per sim day.

### 4. Backend architecture

**Core design.** A server-authoritative, event-sourced simulation with a single writer per world.

- **Sim engine (Node.js + TypeScript).**
  - Fixed tick, for example 1 sim minute per tick at 1x.
  - Entity-component style world state: Position, Needs, Schedule, CareProfile, Memory ref, Relationships.
  - Systems run in order each tick: Rota, Director, Needs decay, Decision (utility), Behaviour trees, Navigation, Interactions, Mind-trigger.
  - A seeded RNG, so a given seed plus inputs gives the same run.
- **LLM worker pool.**
  - A job queue (BullMQ on Redis, or a simple in-process queue for the MVP).
  - Calls Claude via the Anthropic API, or Amazon Bedrock if you want AWS billing and IAM. Bedrock regional endpoints carry a 10% premium over global.\[39\]
  - Results come back as inputs to the engine, stamped with sim time, as AI Town does.\[6\]
- **Event log.** An append-only Postgres table of every input, event and LLM response (sim time, type, actors, payload). It is the source of truth for replay, analytics and future integrations.
- **Snapshots.** World state serialised every N sim minutes to Postgres or S3, for fast restore and branching.
- **Memory store.** Postgres with pgvector for memory embeddings (relevance retrieval), plus a plain-text importance and recency index.
- **Real-time updates.** WebSocket server (ws or Socket.IO):
  - Push compact deltas (positions, state changes, new events) at 5 to 10 Hz.
  - Send full snapshots on connect.
  - Commands (pause, speed, inject, inspect) go the other way as typed messages.
  - Use a shared TypeScript types package for both ends.
- **API.** A Fastify REST API for non-live things: personas, scenario library, runs, exports.
- **Hosting.** Local first. Then a single AWS ECS Fargate service or EC2 box plus RDS Postgres and S3. Personas are synthetic, so there is no real patient data. Still, keep API keys in Secrets Manager.

**Testability.**
- **Deterministic mode.** A fixed seed, with the LLM replaced by a recorded or mock provider, so CI runs are free and repeatable.
- **Golden scenario tests.** For example: "fall injected at 06:40 in Room 1. The RN attends within 10 sim minutes, the resident is not moved before assessment, the family is called, an incident is logged, and a notification is flagged only if a serious injury is flagged."
- **Invariants checked every tick:**
  - at least one staff member on the floor
  - no resident without a check beyond their care-plan interval
  - no two-person transfer with one person
  - visitors cannot enter the staff room
- **LLM evals.** A small rubric set scored by a judge model: in-character, dementia-consistent, no clinical nonsense, respectful.

**Extendable later (interfaces only, do not build now).**
- Every state change is a typed event on an internal bus, and the event log is queryable.
- A future sensor or IoT module would be an "adapter" that subscribes to events (for example resident.position, resident.fell) and publishes its own observations back as inputs.
- Design the event and input schema with a source field (engine, director, user, llm, external) now. That is the only thing you need to add in this version.

### 5. Generating realistic personas and families

**Pipeline:**
1. **Seed constraints (code).** London demographics, the 6 residents' high-level profiles (conditions set by the base-rate table), and the 25 visitor slots allocated across families.
2. **Family tree skeleton (code, deterministic).** Generate people and edges with hard rules:
   - parents 18 to 45 years older than children
   - marriages and divorces dated
   - deaths before care home entry recorded
   - a surname lineage
3. **Narrative fill (LLM with a JSON schema, via tool use).** Personalities, life stories, speech styles, habits, secrets and grievances, per person, with the skeleton passed in as fixed facts.
4. **Pairwise shared memories.** For each strong edge, generate 2 to 5 shared memories written from both sides (Linda remembers the 1987 Margate holiday fondly; Gary remembers the argument on the drive home). Store them once and link them to both people.
5. **Validators (code).** Age and date arithmetic, symmetric relationships, no timeline impossibilities, care needs consistent with conditions, cultural and faith details consistent across relatives, name uniqueness.
6. **Human review.** You read every resident card once. Fix caricatures.
7. **Freeze and version.** Persona set v1 is immutable; runs reference a version.

#### Example schema: resident

```json
{
  "id": "res_peggy",
  "name": {"first": "Margaret", "known_as": "Peggy", "last": "Holloway"},
  "dob": "1937-03-14",
  "room": "Room1.BedA",
  "admitted": "2025-11-02",
  "origin": "Hackney, East London",
  "life_story": ["School dinner lady 1962-1997", "Married Ron 1958, widowed 2016", "Loved dancing at the Palais"],
  "personality": {"openness": 0.5, "conscientiousness": 0.7, "extraversion": 0.8, "agreeableness": 0.7, "neuroticism": 0.6},
  "speech_style": "Cockney, calls everyone 'love', repeats questions",
  "cognition": {"diagnosis": "Alzheimer's disease", "stage": "moderate", "capacity": {"daily_choices": true, "finances": false, "treatment": "decision-specific"}, "memory_profile": {"recent_retention_hours": 2, "time_anchor_at_dusk": 1972, "misidentification_rate": 0.15}, "sundowning": {"onset": "16:00", "severity": 0.6}},
  "mobility": {"aid": "zimmer frame", "transfer": "1 staff standby", "falls_risk": "high", "walk_speed_mps": 0.4},
  "continence": "urinary incontinence, pads, prompted toileting 2-hourly",
  "nutrition": {"diet": "normal, fortified", "fluids_target_ml": 1500, "likes": ["tea, 3 sugars", "custard creams"], "dislikes": ["fish"]},
  "medication_rounds": ["08:00", "13:00", "17:00", "22:00"],
  "routine": {"wake": "07:30", "bed": "21:00", "nap": "14:00"},
  "preferences": ["music: Vera Lynn, Elvis", "cardigan buttoned up", "female carers only for personal care"],
  "legal": {"dnacpr": false, "lpa_health": "Linda", "dols": "granted 2026-01"},
  "staff_relationships": [{"staff": "stf_blessing", "trust": 0.9, "note": "calls her 'my Blessing'"}, {"staff": "stf_tom", "trust": 0.4}],
  "goals": ["find Ron", "go home to feed the cat"],
  "triggers": ["loud voices", "men in the room at night"]
}
```

#### Example schema: family member (visitor)

```json
{
  "id": "vis_linda",
  "name": "Linda Carter",
  "age": 62,
  "relation_to_resident": [{"resident": "res_peggy", "type": "daughter"}],
  "occupation": "part-time school receptionist",
  "home": "Walthamstow, 35 mins by bus",
  "personality": {"agreeableness": 0.5, "neuroticism": 0.8},
  "emotional_state": {"guilt": 0.8, "grief_anticipatory": 0.6, "trust_in_home": 0.5},
  "visit_pattern": {"days": ["Mon","Tue","Wed","Thu","Sat"], "time_window": "14:00-16:00", "duration_mins": 90, "reliability": 0.85},
  "visit_behaviours": ["brings custard creams", "checks the clothes labels", "asks for the fluid chart"],
  "conflicts": [{"with": "vis_gary", "issue": "he doesn't visit, she does everything", "intensity": 0.7}],
  "attitudes_to_staff": {"stf_blessing": 0.9, "stf_joanne": 0.4},
  "secrets": ["thinks Mum should have stayed home and blames herself"],
  "offscreen_life_hooks": ["husband Mick's redundancy", "her own knee operation in spring"]
}
```

#### Example schema: staff

```json
{
  "id": "stf_dave",
  "name": "Dave Collins", "age": 47, "role": "senior_carer",
  "experience_years": 9, "prior": "Royal Logistic Corps, 12 years",
  "competencies": ["meds_trained", "moving_handling_trainer", "dementia_level2"],
  "contract": {"hours_per_week": 37.5, "patterns": ["late", "night"], "sickness_propensity": 0.03},
  "personality": {"conscientiousness": 0.8, "agreeableness": 0.4, "extraversion": 0.6},
  "stress": {"baseline": 0.4, "rises_with": ["paperwork", "short staffing"], "coping": "smoke break, humour"},
  "care_style": "practical, calm under pressure, blunt with families",
  "relationships": [{"with": "stf_joanne", "type": "manager", "tension": 0.6}, {"with": "stf_tom", "type": "junior", "note": "protective but gruff"}, {"with": "res_stan", "rapport": 0.9, "note": "both ex-East End, talk football"}]
}
```

#### Example schema: relationship edge (graph)

```json
{"from": "vis_funmi", "to": "vis_tunde", "type": "sibling", "closeness": 0.5, "tension": 0.8,
 "history": ["Tunde moved to Manchester in 2004", "Funmi was Mum's main carer 2019-2025"],
 "live_issues": ["DNACPR decision for Mum", "selling Mum's flat"],
 "shared_memory_ids": ["mem_0412", "mem_0413"]}
```

#### The cast (6 residents, 25-person visitor pool)

- **Room 1 (female room)**
  - **Peggy Holloway, 89**: moderate Alzheimer's, high falls risk, sundowns.
    - Linda (daughter, 62), Mick (son-in-law, 64), Gary (son, 58, lives in Spain, visits twice a year, calls weekly), Chloe (granddaughter, 24, student nurse).
  - **Win Adeyemi, 84**: retired NHS midwife, arrived from Nigeria in 1962, mild vascular dementia, heart failure, type 2 diabetes, Pentecostal.
    - Funmi (daughter), Tunde (son), Kayode (grandson, 19), Sister Grace (church friend).
- **Room 2 (male room)**
  - **Arthur Pemberton, 91**: ex-RAF engineer, full capacity, Parkinson's, proud, lonely.
    - Colin (nephew, visits monthly), Bernard (RAF friend, 90, rarely able to come), Hannah (volunteer befriender).
  - **Raj Sandhu, 79**: retired bus driver, stroke with left-sided weakness and aphasia, 2-person hoist.
    - Kuldip (wife, 76, daily with food), Harpreet (son), Simran (daughter-in-law), Arjun (12) and Priya (9), grandchildren.
  - **Stan Brooks, 82**: former market trader, Lewy body dementia, hallucinations and night wandering.
    - Maureen (second wife), Tracey (daughter from first marriage), Sheila (ex-wife, occasional), Terry (old market mate).
  - **Dennis Hart, 87**: advanced dementia, bed-bound, entering end of life.
    - Sarah (daughter), Paul (son), Mia (granddaughter), Pat (sister), Father Michael (parish priest).

That is 25 visitors. Visit schedules are sampled from each person's pattern, with reliability and mood modifiers, so on a normal afternoon 3 to 8 are on site.

## Recommendations

**Final tech stack:**
- **Language:** TypeScript end to end, as a monorepo (pnpm workspaces): `sim-engine`, `server`, `web`, `shared-types`, `persona-gen`.
- **Frontend:** React + Vite, Phaser 3 for the world canvas, Tiled for maps, Zustand for dashboard state, Recharts for metrics.
- **Backend:** Node.js + Fastify, ws WebSockets, BullMQ + Redis for LLM jobs, Postgres + pgvector, S3 for snapshots.
- **LLM:** Claude Haiku 4.5 by default, Sonnet 5 for plans, reflections and Tier A scenes, and the Batch API for overnight and off-screen work. Call it via the Anthropic SDK, or Bedrock if you prefer AWS billing.
- **Testing:** Vitest, seeded RNG, a recorded-LLM provider, and golden scenario tests.
- **Deploy:** Docker, then AWS ECS Fargate + RDS + S3.

**Phased roadmap (solo, full-time equivalent):**

| Phase | Scope | Effort |
|---|---|---|
| 0. Design | Tiled map of the wing, zone list, rota, care rules, persona skeletons, event schema | 1 week |
| 1. Rules-only MVP | Tick engine, sim clock (pause to 360x), rota and handovers, needs + utility AI, behaviour trees for 5 core procedures, A* movement, Phaser view, follow camera, inspector, event log | 3 to 4 weeks |
| 2. Minds | Memory stream + retrieval, dementia-aware memory, LLM dialogue and thoughts, daily plan and reflection, tiered fidelity, caching, budget governor, cost meter | 3 to 4 weeks |
| 3. Director and scenarios | Base-rate director, 15 to 20 scenario cards, manual injection UI, CQC notification tasks, golden tests | 3 weeks |
| 4. Living families | Full 25-person visitor pool, off-screen life batches, relationship dynamics over weeks, snapshots, replay, branch-from-here | 3 to 4 weeks |
| 5. Polish and options | Better sprites and animations, analytics, headless batch runs (optionally in Mesa or Node) to calibrate rates. Later: 3D view, more wings, plug-in adapters | Ongoing |

**What to do first:** draw the map in Tiled and write the rota and five behaviour trees (morning personal care, med round, meal service, fall response, night check) before touching the LLM. If the world is believable with rules alone, the LLM layer only has to add voice and memory. If it isn't, no prompt will save it.

## Caveats

- **Base rates are approximate and context-dependent.**
  - The falls study sampled residents who had fallen, matched with non-fallers, aged 75+ and not bed-bound.\[26\]\[27\]
  - The 26.2% one-year mortality figure comes from an older England and Wales cohort.\[32\]
  - Sundowning prevalence varies enormously by definition (2.5% to 80% across sources).\[29\]\[30\]

  Treat these as tunable parameters, not truths.
- **Some workforce figures are secondary.** The turnover percentages came via a recruiter's summary of Skills for Care's report, not the report itself.\[16\] Check the primary document before quoting them externally.
- **Model names and prices change often.** The prices above are from Anthropic's pricing page as fetched in September 2026. The cost-per-sim-day figure is my own estimate from assumed call counts and should be measured in Phase 2.
- **Shared rooms.** Two- and four-bed rooms are less common in modern UK homes. I made them single-sex for dignity and plausibility. Say so in any demo.
- **The rota is a simplification.** The 10-person staff team cannot fully cover 24/7 alone. The design relies on off-map support from the main building at night and on agency and bank staff, which matches how small units actually run.
- **LLM bias and dignity.** Generative agents inherit model biases, and Park et al. flag weaker believability for under-represented groups.\[1\] Review generated personas for stereotypes (accents, faiths, dementia portrayed as comic), and keep a human pass on every card.
- **Not a clinical tool.** The sim's care processes are plausible, not authoritative. If you ever use it to test real products or train staff, have a registered nurse or care manager review the behaviour trees against current NICE and CQC guidance.

## Sources

1. [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/pdf/2304.03442)
2. [How to determine the best CQC staff ratio for your care home](https://www.theaccessgroup.com/en-gb/blog/care-staff-to-resident-ratio/)
3. [A new CQC fundamental standard: Visiting and accompanying in care homes, hospitals and hospices](https://www.hempsons.co.uk/news-articles/a-new-cqc-fundamental-standard-visiting-and-accompanying-in-care-homes-hospitals-and-hospices/)
4. [The Care Quality Commission (Registration) Regulations 2009](https://legislation.gov.uk/uksi/2009/3112/regulation/16)
5. [The Care Quality Commission (Registration) Regulations 2009](https://legislation.gov.uk/uksi/2009/3112/regulation/18)
6. [ai-town/ARCHITECTURE.md at main · a16z-infra/ai-town](https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md)
7. [Mesa: Agent-based modeling in Python](https://pypi.org/project/Mesa/)
8. [Safe Staffing in Care Homes: CQC Guide | InspectReady](https://inspectready.co.uk/blog/cqc-safe-staffing-policy/)
9. [Safe staffing levels in health and social care services](https://www.wandptraining.co.uk/cqc-compliance-news/social-care-staff/)
10. [CQC visiting standards: what care home operators need to know | Mills & Reeve](https://www.mills-reeve.com/blogs/health-and-care/september-2024/cqc-visiting-standards-what-care-home-operators-need-to-know/)
11. [Review of CQC Regulation 9A: visiting and accompanying in care homes, hospitals and hospices (18 March 2026) - Care Quality Commission (CQC) - Patient Safety Learning - the hub](https://www.pslhub.org/learn/organisations-linked-to-patient-safety-uk-and-beyond/regulators-and-their-regulations/system-and-product-regulators/cqc/review-of-cqc-regulation-9a-visiting-and-accompanying-in-care-homes-hospitals-and-hospices-18-march-2026-r14261/)
12. [Regulation 18: Notification of other incidents - Care Quality Commission](https://www.cqc.org.uk/guidance-regulation/providers/regulations-service-providers-and-managers/cqc-registration-regulations/regs-regulation-18)
13. [Safeguarding Referrals: Guide for Care Homes 2026 | Statixs](https://statixs.com/blog/safeguarding-referral-care-homes-guide)
14. [Cause for alarm: what can safeguarding data tell us about the challenges facing health and care services? | Nuffield Trust](https://www.nuffieldtrust.org.uk/resource/cause-for-alarm-what-can-safeguarding-data-tell-us-about-the-challenges-facing-health-and-care-services)
15. [Skills for Care - Adult social care vacancy rate falls to lowest level in a decade as workforce grows | Medway Care Portal](https://www.careportal.medway.gov.uk/Article/190056)
16. [Inside the 2025 'State of Social Care' Report: Progress and the Path Ahead - Cohesion Recruitment](https://cohesionrecruitment.com/insights/2025-state-of-social-care/)
17. [The state of the adult social care sector and workforce in England](https://www.skillsforcare.org.uk/Adult-Social-Care-Workforce-Data/workforceintelligence/resources/Reports/National/The-state-of-the-adult-social-care-sector-and-workforce-in-England-2025-Executive-Summary.pdf)
18. [Social Care 360: Workforce And Carers | The King's Fund | The King's Fund](https://www.kingsfund.org.uk/insight-and-analysis/long-reads/social-care-360-workforce-carers)
19. [Care Home Rota & Staff Scheduling Software | ShiftGuard](https://shiftguard.co.uk/industry/care-homes)
20. [Shift Patterns](https://docs.planning.org.uk/20221021/240/RDKOW4RHHAS00/eqk3591du15zg5vu.pdf)
21. [Adult Social Care shift patterns | Newcastle City Council](https://new.newcastle.gov.uk/careers-adult-social-care/adult-social-care-shift-patterns)
22. [Night shift Policy & Procedures for Care Workers – We are care](https://wearecare.co.uk/night-shift-policy-procedures-for-care-workers/)
23. [MANAGING AND ADMINISTERING MEDICATION IN CARE HOMES FOR OLDER PEOPLE](http://www.cpa.org.uk/information/reviews/Managing_and_Administering_Medication_in_Care_Homes.pdf)
24. [Care homes’ use of medicines study: prevalence, causes and potential harm of medication errors in care homes for older people](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2762085/)
25. [Gilmartin a%20comparison care%20homes](https://discovery-pp.ucl.ac.uk/id/eprint/1553312/1/Gilmartin_a%20comparison_care%20homes.pdf)
26. [Falls Among Residents Living in Care Homes Using Real‐Time Data Collection: A Large UK Case‐Control Study - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13092222/)
27. [Falls Among Residents Living in Care Homes Using Real-Time Data Collection: A Large UK Case-Control Study - Ben-Gurion University Research Portal](https://cris.bgu.ac.il/en/publications/falls-among-residents-living-in-care-homes-using-real-time-data-c/)
28. [Care home facts & stats | Settings, population & workforce](https://www.carehome.co.uk/advice/care-home-stats-number-of-settings-population-workforce)
29. [What is dementia sundowning? Signs, symptoms and tips - Dementia UK](https://www.dementiauk.org/information-and-support/health-advice/sundowning/)
30. [Caregiver Experiences and Perceptions of Managing Sundowning Behaviour in Dementia: A Protocol for a Qualitative Evidence Synthesis](https://www.medrxiv.org/content/10.1101/2025.10.14.25338031.full.pdf)
31. [Gross Bimodal Diurnality in Dementia Behavioural Symptoms in an Inpatient Setting: High Noon and Sundown](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9378299/)
32. [Mortality in older care home residents in England and Wales - PubMed](https://pubmed.ncbi.nlm.nih.gov/23305759/)
33. [12 viral gastroenteritis norovirus](https://professionals.lincolnshire.gov.uk/downloads/file/1190/12-viral-gastroenteritis-norovirus)
34. [Loneliness and care homes](https://www.thegoodcaregroup.com/news/loneliness-and-care-homes/)
35. [Augmenting Game AI with Deep Reinforcement Learning](https://arxiv.org/pdf/2606.20210)
36. [Beyond State Machines: Utility AI, Behavior Trees, and Goal-Oriented Planning — The Anatomy of Game Code: Patterns That Survive Any Engine | Socratopia Library](https://www.socratopia.app/library/game-code-anatomy-en/chapter-12)
37. [tigerlily157.gumroad.com](https://tigerlily157.gumroad.com/l/Behavior2)
38. [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442)
39. [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
40. [Claude Pricing 2026: Every Model, Every Tier, Full Breakdown | Coursiv Blog](https://coursiv.io/blog/claude-pricing-2026)
41. [GitHub - sporadic-labs/phaser-navmesh: A plugin for path-finding in Phaser using navmeshes · GitHub](https://github.com/sporadic-labs/phaser-navmesh)
42. [A to Z guide to pathfinding with Easystar and Phaser 3 - Gamedev.js](https://gamedevjs.com/tutorials/a-to-z-guide-to-pathfinding-with-easystar-and-phaser-3/)
43. [Mesa: Agent-based modeling in Python — Mesa 4.0.0a0 documentation](https://mesa.readthedocs.io/latest/)
44. [Lyfe Agents: Generative agents for low-cost real-time social interactions](https://arxiv.org/pdf/2310.02172)
45. [Affordable Generative Agents](https://arxiv.org/html/2402.02053v2)
46. [Using EasyStar.js to implement pathfinding in Tizen game projects | Tizen Developers](https://developer.tizen.org/community/tip-tech/using-easystar.js-implement-pathfinding-tizen-game-projects)
47. [Click here for a demonstration](https://github.com/Bellian/easystarjs)
