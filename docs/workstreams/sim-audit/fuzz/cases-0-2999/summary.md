# Fuzz run cases-0-2999

Baselines: seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 21 days each (calm).

## Rules broken in the baselines (no scripted events)

- **diet_texture** (unsafe): 80 baseline runs (baseline-calm-1, baseline-calm-10, baseline-calm-11, baseline-calm-12, baseline-calm-13, baseline-calm-14, baseline-calm-15, baseline-calm-16, baseline-calm-17, baseline-calm-18, baseline-calm-19, baseline-calm-2, baseline-calm-20, baseline-calm-21, baseline-calm-22, baseline-calm-23, baseline-calm-24, baseline-calm-25, baseline-calm-26, baseline-calm-27, baseline-calm-28, baseline-calm-29, baseline-calm-3, baseline-calm-30, baseline-calm-31, baseline-calm-32, baseline-calm-33, baseline-calm-34, baseline-calm-35, baseline-calm-36, baseline-calm-37, baseline-calm-38, baseline-calm-39, baseline-calm-4, baseline-calm-40, baseline-calm-5, baseline-calm-6, baseline-calm-7, baseline-calm-8, baseline-calm-9, baseline-random-1, baseline-random-10, baseline-random-11, baseline-random-12, baseline-random-13, baseline-random-14, baseline-random-15, baseline-random-16, baseline-random-17, baseline-random-18, baseline-random-19, baseline-random-2, baseline-random-20, baseline-random-21, baseline-random-22, baseline-random-23, baseline-random-24, baseline-random-25, baseline-random-26, baseline-random-27, baseline-random-28, baseline-random-29, baseline-random-3, baseline-random-30, baseline-random-31, baseline-random-32, baseline-random-33, baseline-random-34, baseline-random-35, baseline-random-36, baseline-random-37, baseline-random-38, baseline-random-39, baseline-random-4, baseline-random-40, baseline-random-5, baseline-random-6, baseline-random-7, baseline-random-8, baseline-random-9)
  - baseline-calm-2 Tue 03 Nov 07:04:20 Raj Sandhu (soft and bite-sized (IDDSI level 6), diabetic) given tea and toast
  - baseline-calm-2 Tue 03 Nov 10:36:25 Raj Sandhu (soft and bite-sized (IDDSI level 6), diabetic) given a biscuit on the mid_morning round
  - baseline-calm-2 Tue 03 Nov 15:06:45 Raj Sandhu (soft and bite-sized (IDDSI level 6), diabetic) given a biscuit on the afternoon_tea round
  - baseline-calm-1 Tue 03 Nov 07:04:20 Raj Sandhu (soft and bite-sized (IDDSI level 6), diabetic) given tea and toast
- **drink_for_fallen** (unrealistic): 2 baseline runs (baseline-random-19, baseline-random-4)
  - baseline-random-4 Sat 14 Nov 01:30:15 Peggy Holloway given a drink (drunk) while on the floor after a fall
  - baseline-random-19 Wed 04 Nov 20:02:15 Arthur Pemberton given a drink (left) while on the floor after a fall
- **ecs_visit_cancelled** (unrealistic): 1 baseline runs (baseline-random-13)
  - baseline-random-13 Thu 12 Nov 00:00:00 Funmi Adeyemi (Win's next of kin) turned away for the outbreak
  - baseline-random-13 Thu 12 Nov 00:00:00 Kuldip Kaur Sandhu (Raj's next of kin) turned away for the outbreak
  - baseline-random-13 Thu 12 Nov 00:00:00 Linda Carter (Peggy's next of kin) turned away for the outbreak
  - baseline-random-13 Thu 12 Nov 00:00:00 Maureen Brooks (Stan's next of kin) turned away for the outbreak
- **escort_apart** (unsafe): 7 baseline runs (baseline-calm-21, baseline-calm-38, baseline-calm-39, baseline-calm-4, baseline-random-32, baseline-random-38, baseline-random-39)
  - baseline-calm-4 Mon 16 Nov 13:04:40 Stan Brooks walking (Walk Stan across the Lounge (chatting)) with the carer 2.7 m away
  - baseline-calm-21 Thu 19 Nov 13:00:10 Peggy Holloway walking (Walk Peggy across the Lounge (chatting)) with the carer 2.7 m away
  - baseline-random-32 Mon 16 Nov 12:27:10 Stan Brooks walking (Walk Stan across the Lounge (chatting)) with the carer 2.7 m away
  - baseline-calm-38 Tue 10 Nov 13:06:10 Peggy Holloway walking (Walk Peggy across the Lounge (chatting)) with the carer 2.7 m away
- **fluid_limit_exceeded** (unsafe): 80 baseline runs (baseline-calm-1, baseline-calm-10, baseline-calm-11, baseline-calm-12, baseline-calm-13, baseline-calm-14, baseline-calm-15, baseline-calm-16, baseline-calm-17, baseline-calm-18, baseline-calm-19, baseline-calm-2, baseline-calm-20, baseline-calm-21, baseline-calm-22, baseline-calm-23, baseline-calm-24, baseline-calm-25, baseline-calm-26, baseline-calm-27, baseline-calm-28, baseline-calm-29, baseline-calm-3, baseline-calm-30, baseline-calm-31, baseline-calm-32, baseline-calm-33, baseline-calm-34, baseline-calm-35, baseline-calm-36, baseline-calm-37, baseline-calm-38, baseline-calm-39, baseline-calm-4, baseline-calm-40, baseline-calm-5, baseline-calm-6, baseline-calm-7, baseline-calm-8, baseline-calm-9, baseline-random-1, baseline-random-10, baseline-random-11, baseline-random-12, baseline-random-13, baseline-random-14, baseline-random-15, baseline-random-16, baseline-random-17, baseline-random-18, baseline-random-19, baseline-random-2, baseline-random-20, baseline-random-21, baseline-random-22, baseline-random-23, baseline-random-24, baseline-random-25, baseline-random-26, baseline-random-27, baseline-random-28, baseline-random-29, baseline-random-3, baseline-random-30, baseline-random-31, baseline-random-32, baseline-random-33, baseline-random-34, baseline-random-35, baseline-random-36, baseline-random-37, baseline-random-38, baseline-random-39, baseline-random-4, baseline-random-40, baseline-random-5, baseline-random-6, baseline-random-7, baseline-random-8, baseline-random-9)
  - baseline-calm-2 Wed 04 Nov 21:52:15 Win Adeyemi given 1650 ml today against a 1500 ml limit
  - baseline-calm-2 Thu 05 Nov 21:52:15 Win Adeyemi given 1650 ml today against a 1500 ml limit
  - baseline-calm-2 Fri 06 Nov 21:54:15 Win Adeyemi given 1650 ml today against a 1500 ml limit
  - baseline-calm-1 Tue 03 Nov 21:20:10 Win Adeyemi given 1650 ml today against a 1500 ml limit
- **isolated_in_lounge** (unsafe): 1 baseline runs (baseline-random-11)
  - baseline-random-11 Sat 07 Nov 14:52:10 Peggy Holloway (isolated, norovirus) in the Lounge 26 min after isolation began
- **isolated_left_room** (unsafe): 1 baseline runs (baseline-random-11)
  - baseline-random-11 Sat 07 Nov 14:51:35 Peggy Holloway (isolated, norovirus) left their room for Corridor
- **isolation_too_short** (unrealistic): 3 baseline runs (baseline-random-18, baseline-random-3, baseline-random-40)
  - baseline-random-3 Sat 07 Nov 21:44:00 Win Adeyemi's flu isolation ended 4.1 days after symptoms began
  - baseline-random-18 Tue 17 Nov 02:19:00 Dennis Hart's flu isolation ended 4.4 days after symptoms began
  - baseline-random-40 Sun 08 Nov 09:17:00 Dennis Hart's flu isolation ended 4.7 days after symptoms began
- **lone_carer_two_person_due** (unsafe): 4 baseline runs (baseline-random-18, baseline-random-19, baseline-random-31, baseline-random-9)
  - baseline-random-9 Thu 12 Nov 20:37:05 Turn for Dennis waiting 60 min with 1 carer on the wing and nobody sent for
  - baseline-random-9 Thu 12 Nov 21:00:05 Bedtime care for Raj waiting 60 min with 1 carer on the wing and nobody sent for
  - baseline-random-18 Sat 21 Nov 20:37:05 Turn for Dennis waiting 60 min with 1 carer on the wing and nobody sent for
  - baseline-random-18 Sat 21 Nov 21:00:05 Bedtime care for Raj waiting 60 min with 1 carer on the wing and nobody sent for
- **meds_while_asleep** (unrealistic): 80 baseline runs (baseline-calm-1, baseline-calm-10, baseline-calm-11, baseline-calm-12, baseline-calm-13, baseline-calm-14, baseline-calm-15, baseline-calm-16, baseline-calm-17, baseline-calm-18, baseline-calm-19, baseline-calm-2, baseline-calm-20, baseline-calm-21, baseline-calm-22, baseline-calm-23, baseline-calm-24, baseline-calm-25, baseline-calm-26, baseline-calm-27, baseline-calm-28, baseline-calm-29, baseline-calm-3, baseline-calm-30, baseline-calm-31, baseline-calm-32, baseline-calm-33, baseline-calm-34, baseline-calm-35, baseline-calm-36, baseline-calm-37, baseline-calm-38, baseline-calm-39, baseline-calm-4, baseline-calm-40, baseline-calm-5, baseline-calm-6, baseline-calm-7, baseline-calm-8, baseline-calm-9, baseline-random-1, baseline-random-10, baseline-random-11, baseline-random-12, baseline-random-13, baseline-random-14, baseline-random-15, baseline-random-16, baseline-random-17, baseline-random-18, baseline-random-19, baseline-random-2, baseline-random-20, baseline-random-21, baseline-random-22, baseline-random-23, baseline-random-24, baseline-random-25, baseline-random-26, baseline-random-27, baseline-random-28, baseline-random-29, baseline-random-3, baseline-random-30, baseline-random-31, baseline-random-32, baseline-random-33, baseline-random-34, baseline-random-35, baseline-random-36, baseline-random-37, baseline-random-38, baseline-random-39, baseline-random-4, baseline-random-40, baseline-random-5, baseline-random-6, baseline-random-7, baseline-random-8, baseline-random-9)
  - baseline-calm-2 Tue 03 Nov 21:09:35 Raj Sandhu given the 21:00 tablets while asleep
  - baseline-calm-2 Tue 03 Nov 21:19:30 Peggy Holloway given the 21:00 tablets while asleep
  - baseline-calm-2 Wed 04 Nov 21:10:20 Raj Sandhu given the 21:00 tablets while asleep
  - baseline-calm-2 Wed 04 Nov 21:20:00 Peggy Holloway given the 21:00 tablets while asleep
- **need_unmet_staff_idle** (unsafe): 8 baseline runs (baseline-random-1, baseline-random-15, baseline-random-18, baseline-random-19, baseline-random-28, baseline-random-40, baseline-random-8, baseline-random-9)
  - baseline-random-1 Fri 20 Nov 21:28:00 Peggy Holloway's toileting at 1.00 for 370 min while Lorna is free
  - baseline-random-8 Sat 14 Nov 21:27:00 Peggy Holloway's toileting at 1.00 for 82 min while Lorna is free
  - baseline-random-9 Thu 12 Nov 20:51:00 Peggy Holloway's toileting at 1.00 for 60 min while Kasia is tidying
  - baseline-random-9 Thu 12 Nov 20:52:00 Peggy Holloway's toileting at 1.00 for 61 min while Kasia is tidying
- **no_break** (unrealistic): 12 baseline runs (baseline-random-13, baseline-random-18, baseline-random-19, baseline-random-24, baseline-random-27, baseline-random-3, baseline-random-31, baseline-random-33, baseline-random-35, baseline-random-38, baseline-random-8, baseline-random-9)
  - baseline-random-3 Sun 15 Nov 14:30:00 Kasia Nowak worked the early shift (7.5 h) with no break
  - baseline-random-8 Fri 20 Nov 14:30:00 Blessing Mensah worked the early shift (7.5 h) with no break
  - baseline-random-9 Thu 12 Nov 21:30:00 Kasia Nowak worked the late shift (7.5 h) with no break
  - baseline-random-13 Wed 11 Nov 14:30:00 Blessing Mensah worked the early shift (7.5 h) with no break
- **no_woman_for_female_only** (unsafe): 10 baseline runs (baseline-random-1, baseline-random-11, baseline-random-15, baseline-random-18, baseline-random-19, baseline-random-28, baseline-random-31, baseline-random-33, baseline-random-40, baseline-random-8)
  - baseline-random-1 Fri 20 Nov 15:45:05 Toilet prompt for Peggy waiting 60 min with no woman on shift on the wing
  - baseline-random-1 Fri 20 Nov 15:51:05 Toilet for Peggy waiting 60 min with no woman on shift on the wing
  - baseline-random-8 Sat 14 Nov 20:32:05 Toilet prompt for Peggy waiting 60 min with no woman on shift on the wing
  - baseline-random-8 Sat 14 Nov 20:38:05 Toilet for Peggy waiting 60 min with no woman on shift on the wing
- **office_covered_by_carer** (unrealistic): 1 baseline runs (baseline-random-36)
  - baseline-random-36 Wed 18 Nov 00:00:00 Lucy Brennan (bank) booked for the reception slot of Sanjay Mehta
  - baseline-random-36 Thu 19 Nov 00:00:00 Ioana Radu (agency) booked for the reception slot of Sanjay Mehta
- **request_unanswered_2h** (unsafe): 8 baseline runs (baseline-random-1, baseline-random-11, baseline-random-15, baseline-random-18, baseline-random-19, baseline-random-33, baseline-random-40, baseline-random-8)
  - baseline-random-1 Fri 20 Nov 16:51:05 Toilet for Peggy waiting 120 min (female carers only)
  - baseline-random-8 Sat 14 Nov 21:38:05 Toilet for Peggy waiting 120 min (female carers only)
  - baseline-random-11 Fri 13 Nov 10:14:05 Toilet for Peggy waiting 120 min (female carers only)
  - baseline-random-15 Sun 15 Nov 21:38:05 Toilet for Peggy waiting 120 min (female carers only)
- **seated_too_long** (unsafe): 80 baseline runs (baseline-calm-1, baseline-calm-10, baseline-calm-11, baseline-calm-12, baseline-calm-13, baseline-calm-14, baseline-calm-15, baseline-calm-16, baseline-calm-17, baseline-calm-18, baseline-calm-19, baseline-calm-2, baseline-calm-20, baseline-calm-21, baseline-calm-22, baseline-calm-23, baseline-calm-24, baseline-calm-25, baseline-calm-26, baseline-calm-27, baseline-calm-28, baseline-calm-29, baseline-calm-3, baseline-calm-30, baseline-calm-31, baseline-calm-32, baseline-calm-33, baseline-calm-34, baseline-calm-35, baseline-calm-36, baseline-calm-37, baseline-calm-38, baseline-calm-39, baseline-calm-4, baseline-calm-40, baseline-calm-5, baseline-calm-6, baseline-calm-7, baseline-calm-8, baseline-calm-9, baseline-random-1, baseline-random-10, baseline-random-11, baseline-random-12, baseline-random-13, baseline-random-14, baseline-random-15, baseline-random-16, baseline-random-17, baseline-random-18, baseline-random-19, baseline-random-2, baseline-random-20, baseline-random-21, baseline-random-22, baseline-random-23, baseline-random-24, baseline-random-25, baseline-random-26, baseline-random-27, baseline-random-28, baseline-random-29, baseline-random-3, baseline-random-30, baseline-random-31, baseline-random-32, baseline-random-33, baseline-random-34, baseline-random-35, baseline-random-36, baseline-random-37, baseline-random-38, baseline-random-39, baseline-random-4, baseline-random-40, baseline-random-5, baseline-random-6, baseline-random-7, baseline-random-8, baseline-random-9)
  - baseline-calm-2 Tue 03 Nov 13:53:20 Raj Sandhu sitting out of bed for 6.0 h with no change of position
  - baseline-calm-2 Wed 04 Nov 14:01:15 Raj Sandhu sitting out of bed for 6.0 h with no change of position
  - baseline-calm-2 Thu 05 Nov 13:53:20 Raj Sandhu sitting out of bed for 6.0 h with no change of position
  - baseline-calm-1 Tue 03 Nov 13:53:20 Raj Sandhu sitting out of bed for 6.0 h with no change of position
- **time_critical_dose_late** (unsafe): 1 baseline runs (baseline-random-12)
  - baseline-random-12 Sat 21 Nov 08:33:15 Arthur Pemberton's 08:00 dose 33 min late (time-critical: within 30 minutes)
- **turn_repeated** (unrealistic): 80 baseline runs (baseline-calm-1, baseline-calm-10, baseline-calm-11, baseline-calm-12, baseline-calm-13, baseline-calm-14, baseline-calm-15, baseline-calm-16, baseline-calm-17, baseline-calm-18, baseline-calm-19, baseline-calm-2, baseline-calm-20, baseline-calm-21, baseline-calm-22, baseline-calm-23, baseline-calm-24, baseline-calm-25, baseline-calm-26, baseline-calm-27, baseline-calm-28, baseline-calm-29, baseline-calm-3, baseline-calm-30, baseline-calm-31, baseline-calm-32, baseline-calm-33, baseline-calm-34, baseline-calm-35, baseline-calm-36, baseline-calm-37, baseline-calm-38, baseline-calm-39, baseline-calm-4, baseline-calm-40, baseline-calm-5, baseline-calm-6, baseline-calm-7, baseline-calm-8, baseline-calm-9, baseline-random-1, baseline-random-10, baseline-random-11, baseline-random-12, baseline-random-13, baseline-random-14, baseline-random-15, baseline-random-16, baseline-random-17, baseline-random-18, baseline-random-19, baseline-random-2, baseline-random-20, baseline-random-21, baseline-random-22, baseline-random-23, baseline-random-24, baseline-random-25, baseline-random-26, baseline-random-27, baseline-random-28, baseline-random-29, baseline-random-3, baseline-random-30, baseline-random-31, baseline-random-32, baseline-random-33, baseline-random-34, baseline-random-35, baseline-random-36, baseline-random-37, baseline-random-38, baseline-random-39, baseline-random-4, baseline-random-40, baseline-random-5, baseline-random-6, baseline-random-7, baseline-random-8, baseline-random-9)
  - baseline-calm-2 Tue 03 Nov 19:44:20 Dennis Hart turned again 12 min after the last turn
  - baseline-calm-2 Wed 04 Nov 19:36:00 Dennis Hart turned again 11 min after the last turn
  - baseline-calm-2 Wed 04 Nov 19:47:00 Dennis Hart turned again 11 min after the last turn
  - baseline-calm-1 Tue 03 Nov 19:36:05 Dennis Hart turned again 11 min after the last turn

## New failures in 3000 cases (not in the seed's baseline)

Engine crashes: 0. Mean case time 1384 ms.

Themes: cluster 438, night 286, random_plus 280, back_to_back 338, illness_mix 249, short_staffed 249, hospital_return 239, holiday 280, eol_chain 281, outbreak 360.

### turn_repeated (unrealistic): 609 cases

- themes: cluster 88, eol_chain 179, back_to_back 75, random_plus 30, night 56, illness_mix 50, hospital_return 47, outbreak 72, holiday 12
- who: res_peggy 145, res_arthur 138, res_stan 130, res_win 118, res_raj 113
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/turn_repeated-fuzz-00000.json (1 events, 39 h): Raj Sandhu turned again 11 min after the last turn
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/turn_repeated-fuzz-00015.json (1 events, 15 h): Arthur Pemberton turned again 58 min after the last turn

### ecs_visit_cancelled (unrealistic): 590 cases

- themes: back_to_back 21, outbreak 284, holiday 161, illness_mix 23, eol_chain 18, random_plus 20, hospital_return 28, cluster 18, short_staffed 17
- who: vis_kuldip 566, vis_maureen 532, vis_linda 528, vis_funmi 503, vis_colin 67, vis_hema 8
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/ecs_visit_cancelled-fuzz-00024.json (1 events, 43 h): Linda Carter (Peggy's next of kin) turned away for the outbreak
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/ecs_visit_cancelled-fuzz-00005.json (1 events, 43 h): Kuldip Kaur Sandhu (Raj's next of kin) turned away for the outbreak

### drink_for_fallen (unrealistic): 314 cases

- themes: cluster 61, random_plus 27, illness_mix 51, hospital_return 49, back_to_back 43, short_staffed 26, outbreak 31, night 10, eol_chain 13, holiday 3
- who: res_stan 65, res_arthur 57, res_win 55, res_dennis 55, res_raj 54, res_peggy 46
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/drink_for_fallen-fuzz-00006.json (2 events, 10 h): Peggy Holloway given a drink (drunk) while on the floor after a fall
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/drink_for_fallen-fuzz-00003.json (1 events, 59 h): Win Adeyemi given a drink (left) while on the floor after a fall

### no_break (unrealistic): 254 cases

- themes: back_to_back 37, hospital_return 25, short_staffed 45, outbreak 38, random_plus 34, night 7, eol_chain 28, cluster 29, holiday 3, illness_mix 8
- who: stf_aisha 60, stf_dave 53, stf_kasia 50, stf_florin 40, stf_blessing 30, stf_shanice 18, stf_lucy 18, agy_002 8, stf_tom 7, agy_004 5, agy_003 4, agy_014 3, agy_006 3, ext_main_carer 3, agy_009 3, agy_008 2, agy_005 2
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/no_break-fuzz-00035.json (1 events, 41 h): Aisha Rahman worked the late shift (7.5 h) with no break
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/no_break-fuzz-00013.json (1 events, 89 h): Dave Collins worked the late shift (7.5 h) with no break

### no_woman_for_female_only (unsafe): 171 cases

- themes: night 5, illness_mix 6, back_to_back 20, hospital_return 18, short_staffed 26, outbreak 26, eol_chain 35, cluster 18, random_plus 14, holiday 3
- who: res_peggy 144, res_kamala 28
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/no_woman_for_female_only-fuzz-00092.json (2 events, 138 h): Bedtime care for Kamala waiting 60 min with no woman on shift on the wing
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/no_woman_for_female_only-fuzz-00001.json (1 events, 40 h): Toilet prompt for Peggy waiting 60 min with no woman on shift on the wing

### female_only_by_man (unsafe): 167 cases

- themes: cluster 22, hospital_return 10, night 24, eol_chain 55, back_to_back 13, outbreak 14, random_plus 14, illness_mix 12, holiday 3
- who: res_peggy 167
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/female_only_by_man-fuzz-00031.json (1 events, 34 h): Turn for Peggy for Peggy Holloway (female carers only) with Dave Collins

### need_unmet_staff_idle (unsafe): 142 cases

- themes: illness_mix 5, hospital_return 17, outbreak 31, random_plus 18, cluster 18, eol_chain 11, back_to_back 17, short_staffed 17, night 5, holiday 3
- who: res_peggy 110, res_dennis 12, res_arthur 8, res_stan 7, res_win 7, res_raj 5
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/need_unmet_staff_idle-fuzz-00018.json (2 events, 152 h): Peggy Holloway's hunger at 1.00 for 66 min while Tom is tidying
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/need_unmet_staff_idle-fuzz-00013.json (1 events, 93 h): Dennis Hart's toileting at 1.00 for 207 min while Lorna is free

### isolated_visitors_over_limit (unsafe): 139 cases

- themes: holiday 68, illness_mix 4, short_staffed 14, cluster 11, hospital_return 7, outbreak 15, random_plus 6, back_to_back 10, eol_chain 4
- who: res_raj 49, res_win 27, res_peggy 25, res_stan 24, res_arthur 15
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/isolated_visitors_over_limit-fuzz-00026.json (2 events, 35 h): Win Adeyemi (isolated, flu) has 3 visitors: Funmi, Sister, Tunde
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/isolated_visitors_over_limit-fuzz-00011.json (2 events, 35 h): Stan Brooks (isolated, flu) has 3 visitors: Maureen, Terry, Tracey

### meds_while_asleep (unrealistic): 132 cases

- themes: back_to_back 20, outbreak 37, short_staffed 18, random_plus 13, hospital_return 10, cluster 18, eol_chain 8, holiday 7, illness_mix 1
- who: res_win 119, res_dennis 54, res_stan 41
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/meds_while_asleep-fuzz-00035.json (1 events, 42 h): Win Adeyemi given the 21:00 tablets while asleep
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/meds_while_asleep-fuzz-00108.json (1 events, 42 h): Stan Brooks given the 21:00 tablets while asleep

### lone_carer_two_person_due (unsafe): 128 cases

- themes: cluster 17, back_to_back 19, hospital_return 14, short_staffed 25, random_plus 14, outbreak 24, eol_chain 9, illness_mix 3, night 2, holiday 1
- who: res_raj 116, res_dennis 112, res_win 5, res_peggy 3, res_stan 3, res_arthur 2
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/lone_carer_two_person_due-fuzz-00031.json (3 events, 35 h): Turn for Dennis waiting 60 min with 1 carer on the wing and nobody sent for
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/lone_carer_two_person_due-fuzz-00013.json (1 events, 89 h): Bedtime care for Raj waiting 60 min with 1 carer on the wing and nobody sent for

### time_critical_dose_late (unsafe): 104 cases

- themes: back_to_back 18, short_staffed 21, random_plus 15, outbreak 21, cluster 12, eol_chain 4, holiday 2, hospital_return 9, illness_mix 2
- who: res_arthur 104
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/time_critical_dose_late-fuzz-00035.json (1 events, 42 h): Arthur Pemberton's 21:00 dose 67 min late (time-critical: within 30 minutes)

### eol_visit_cancelled (unsafe): 95 cases

- themes: outbreak 66, back_to_back 6, illness_mix 3, holiday 8, hospital_return 3, eol_chain 4, random_plus 3, cluster 2
- who: vis_funmi 31, vis_kayode 31, vis_grace 30, vis_tunde 28, vis_hannah 24, vis_bernard 20, vis_colin 20, vis_kuldip 19, vis_maureen 17, vis_tracey 17, vis_harpreet 17, vis_terry 16, vis_sheila 15, vis_chloe 12, vis_linda 12, vis_gary 7, vis_arjun 5, vis_priya 4, vis_mick 2, vis_simran 2
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/eol_visit_cancelled-fuzz-00130.json (3 events, 91 h): Funmi Adeyemi's visit to Win Adeyemi, at the end of their life, cancelled for the outbreak
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/eol_visit_cancelled-fuzz-00166.json (3 events, 91 h): Chloe Carter's visit to Peggy Holloway, at the end of their life, cancelled for the outbreak

### request_unanswered_2h (unsafe): 84 cases

- themes: illness_mix 4, hospital_return 13, outbreak 21, random_plus 13, eol_chain 8, cluster 5, night 4, short_staffed 10, holiday 3, back_to_back 3
- who: res_peggy 81, res_raj 6
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/request_unanswered_2h-fuzz-01145.json (3 events, 90 h): Toilet for Raj waiting 120 min (two staff)
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/request_unanswered_2h-fuzz-00018.json (2 events, 150 h): Toilet for Peggy waiting 120 min (female carers only)

### office_covered_by_carer (unrealistic): 80 cases

- themes: hospital_return 15, illness_mix 14, short_staffed 7, eol_chain 11, back_to_back 8, outbreak 6, random_plus 9, cluster 9, holiday 1
- who: stf_lucy 53, stf_shanice 39, agy_002 19, agy_004 14, agy_003 13, agy_012 5, agy_007 5, agy_008 3, agy_005 3, agy_016 3, agy_019 3, agy_015 2, agy_013 2, agy_009 2, agy_014 2, agy_006 2, agy_020 1, agy_018 1, agy_022 1
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/office_covered_by_carer-fuzz-00083.json (1 events, 322 h): Lucy Brennan (bank) booked for the reception slot of Sanjay Mehta
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/office_covered_by_carer-fuzz-00099.json (2 events, 211 h): Nadia Hussain (agency) booked for the reception slot of Sanjay Mehta

### isolation_too_short (unrealistic): 64 cases

- themes: outbreak 36, hospital_return 10, illness_mix 8, eol_chain 5, random_plus 5
- who: res_win 15, res_arthur 14, res_raj 14, res_stan 13, res_dennis 6, res_peggy 6
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/isolation_too_short-fuzz-00101.json (1 events, 117 h): Stan Brooks's flu isolation ended 4.1 days after symptoms began
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/isolation_too_short-fuzz-00167.json (2 events, 119 h): Arthur Pemberton's flu isolation ended 4.0 days after symptoms began

### escort_apart (unsafe): 52 cases

- themes: back_to_back 7, illness_mix 4, night 4, holiday 6, hospital_return 12, random_plus 2, eol_chain 12, cluster 2, short_staffed 2, outbreak 1
- who: res_stan 35, res_peggy 17
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/escort_apart-fuzz-00037.json (2 events, 32 h): Stan Brooks walking (Walk Stan across the Lounge (chatting)) with the carer 2.7 m away
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/escort_apart-fuzz-00196.json (1 events, 33 h): Peggy Holloway walking (Walk Peggy across the Lounge (chatting)) with the carer 2.7 m away

### isolated_left_room (unsafe): 45 cases

- themes: hospital_return 2, holiday 16, short_staffed 3, outbreak 11, back_to_back 5, cluster 4, random_plus 3, illness_mix 1
- who: res_stan 14, res_arthur 12, res_peggy 10, res_win 9
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/isolated_left_room-fuzz-00205.json (1 events, 35 h): Arthur Pemberton (isolated, flu) still in Lounge 30 min after isolation began
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/isolated_left_room-fuzz-00172.json (2 events, 130 h): Peggy Holloway (isolated, norovirus) left their room for Corridor

### isolated_in_lounge (unsafe): 36 cases

- themes: hospital_return 2, holiday 14, short_staffed 2, outbreak 10, back_to_back 3, random_plus 3, illness_mix 1, cluster 1
- who: res_arthur 11, res_stan 11, res_peggy 7, res_win 7
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/isolated_in_lounge-fuzz-00205.json (1 events, 34 h): Arthur Pemberton (isolated, flu) in the Lounge 20 min after isolation began
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/isolated_in_lounge-fuzz-00172.json (2 events, 130 h): Peggy Holloway (isolated, norovirus) in the Lounge 22 min after isolation began

### outbreak_lounge_use (unsafe): 34 cases

- themes: eol_chain 1, holiday 15, outbreak 11, hospital_return 1, short_staffed 2, random_plus 2, back_to_back 1, illness_mix 1
- who: res_stan 15, res_peggy 8, res_arthur 6, res_win 5
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/outbreak_lounge_use-fuzz-00146.json (2 events, 35 h): Arthur Pemberton in the Lounge 30 min into an outbreak
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/outbreak_lounge_use-fuzz-00100.json (2 events, 130 h): Peggy Holloway in the Lounge 35 min into an outbreak

### eol_conveyed_to_hospital (unrealistic): 31 cases

- themes: cluster 7, night 7, outbreak 1, illness_mix 6, back_to_back 7, hospital_return 1, eol_chain 1, random_plus 1
- who: res_peggy 7, res_stan 6, res_dennis 5, res_raj 5, res_win 4, res_arthur 4
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/eol_conveyed_to_hospital-fuzz-00324.json (2 events, 28 h): Dennis Hart taken to hospital (serious_fall) during a planned end-of-life decline
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/eol_conveyed_to_hospital-fuzz-00322.json (2 events, 4 h): Stan Brooks taken to hospital (serious_fall) during a planned end-of-life decline

### absent_resident_state (integrity): 29 cases

- themes: cluster 5, random_plus 2, short_staffed 1, back_to_back 9, hospital_return 3, outbreak 2, night 3, illness_mix 1, eol_chain 3
- who: res_raj 23, res_peggy 4, res_arthur 1, vis_tracey 1
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/absent_resident_state-fuzz-00153.json (1 events, 4 h): Peggy Holloway is hospital but asking for help
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/absent_resident_state-fuzz-00313.json (2 events, 59 h): Raj Sandhu is hospital but asking for help

### meal_for_comfort_only (integrity): 19 cases

- themes: back_to_back 6, illness_mix 1, hospital_return 1, eol_chain 6, cluster 3, outbreak 2
- who: res_win 6, res_arthur 6, res_raj 6, res_peggy 2
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/meal_for_comfort_only-fuzz-00098.json (1 events, 27 h): Arthur Pemberton served breakfast on comfort feeding only
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/meal_for_comfort_only-fuzz-00078.json (1 events, 28 h): Win Adeyemi served breakfast on comfort feeding only

### excessive_hours (unsafe): 19 cases

- themes: eol_chain 2, hospital_return 6, holiday 1, outbreak 2, short_staffed 3, random_plus 3, cluster 1, illness_mix 1
- who: stf_maria 10, stf_lucy 7, stf_shanice 2
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/excessive_hours-fuzz-00398.json (1 events, 50 h): Maria Santos back after 11.0 h off
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/excessive_hours-fuzz-00204.json (1 events, 76 h): Lucy Brennan back after 10.5 h off

### sick_staff_giving_care (unsafe): 16 cases

- themes: outbreak 8, random_plus 4, eol_chain 2, short_staffed 1, holiday 1
- who: stf_aisha 5, stf_dave 3, stf_blessing 3, stf_florin 2, stf_lucy 2, stf_kasia 1
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/sick_staff_giving_care-fuzz-00312.json (3 events, 43 h): Florin Popescu, with norovirus symptoms for 5 min, on Turn for Dennis
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/sick_staff_giving_care-fuzz-00433.json (3 events, 92 h): Aisha Rahman, with norovirus symptoms for 5 min, on Turn for Dennis

### admission_during_outbreak (unsafe): 10 cases

- themes: eol_chain 10
- who: res_kamala 10
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/admission_during_outbreak-fuzz-00776.json (3 events, 101 h): Kamala Shah moved in during an outbreak

### two_person (unsafe): 5 cases

- themes: hospital_return 5
- who: - 5
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/two_person-fuzz-00013.json (1 events, 306 h): t005315 (Toilet for Peggy) with 0 staff

### float_overstay (unrealistic): 5 cases

- themes: hospital_return 5
- who: ext_night_float 5
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/float_overstay-fuzz-00013.json (1 events, 310 h): Lorna Mitchell on the wing for 240 min (since 22.15 h)

### care_for_absent_resident (integrity): 5 cases

- themes: eol_chain 2, outbreak 2, cluster 1
- who: res_dennis 3, res_arthur 1, res_stan 1
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/care_for_absent_resident-fuzz-02735.json (1 events, 37 h): visit.started for Arthur Pemberton, who is died
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/care_for_absent_resident-fuzz-00747.json (1 events, 39 h): visit.started for Dennis Hart, who is died

### died_on_return (unrealistic): 2 cases

- themes: illness_mix 2
- who: res_arthur 1, res_peggy 1
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/died_on_return-fuzz-02860.json (2 events, 175 h): Peggy Holloway died 0 min after coming back from hospital
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/died_on_return-fuzz-00688.json (2 events, 175 h): Arthur Pemberton died 0 min after coming back from hospital

### meds_trained (unsafe): 1 cases

- themes: outbreak 1
- who: stf_lucy 1
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/meds_trained-fuzz-00742.json (3 events, 65 h): Lucy Brennan gave Dennis Hart's medication

### floor_cover (unsafe): 1 cases

- themes: outbreak 1
- who: - 1
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/floor_cover-fuzz-00807.json (2 events, 41 h): no on-duty care staff on the floor

### bed_bound_out_of_bed (unsafe): 1 cases

- themes: eol_chain 1
- who: res_peggy 1
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/bed_bound_out_of_bed-fuzz-01180.json (1 events, 9 h): Peggy Holloway (bed-bound) out of bed at Room5

### dose_skipped_unrecorded (unsafe): 1 cases

- themes: outbreak 1
- who: res_kamala 1
- case: ../../docs/workstreams/sim-audit/fuzz/cases-0-2999/cases/dose_skipped_unrecorded-fuzz-01468.json (4 events, 52 h): Kamala Shah was on the wing but got no 08:00 dose and none was recorded as missed

