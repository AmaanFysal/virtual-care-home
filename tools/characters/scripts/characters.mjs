// 50 characters for the virtual care home, as LPC generator URL-hash selections.
// Each value is `Item_Name_colour` (spaces -> underscores), per the generator's hash format.

const base = (sex, skin, head, { elderly = false } = {}) => ({
  sex,
  body: `Body_Color_${skin}`,
  head: `${head}_${skin}`,
  expression: `Neutral_${skin}`,
  eyes: "Eye_Color_brown",
  ...(elderly ? { wrinkles: `Wrinkles_${skin}` } : {}),
});
const F = (skin, o) => base("female", skin, "Human_Female", o);
const Girl = (skin) => base("teen", skin, "Human_Female_Small");
const M = (skin, o) => base("male", skin, "Human_Male", o);
const OldF = (skin) => base("female", skin, "Human_Female_Elderly", { elderly: true });
const OldM = (skin) => base("male", skin, "Human_Male_Elderly", { elderly: true });

// Uniform presets (agency staff wear their agency's pink, all.lpcr.pink, not these)
const carer = { clothes: "Shortsleeve_Polo_lavender", legs: "Pants_navy", shoes: "Basic_Shoes_black" };
const senior = { clothes: "Shortsleeve_Polo_blue", legs: "Pants_navy", shoes: "Basic_Shoes_black" };
const paramedic = { clothes: "Shortsleeve_Polo_forest", legs: "Pants_forest", shoes: "Basic_Boots_black" }; // UK ambulance bottle green

export const characters = [
  // ---- Residents (data/personas/residents.json) ----
  { id: "res_peggy", name: "Peggy Holloway", group: "resident", note: "89, zimmer frame",
    hash: { ...OldF("light"), hair: "Curly_short_white", clothes: "Cardigan_rose", legs: "Pants_navy", shoes: "Slippers_maroon" } },
  { id: "res_win", name: "Win Adeyemi", group: "resident", note: "84, walking stick",
    hash: { ...OldF("black"), hair: "Afro_gray", clothes: "Longsleeve_2_Buttoned_purple", legs: "Pants_charcoal", shoes: "Basic_Shoes_black", facial_eyes: "Halfmoon_Glasses_silver", necklace: "Small_Beaded_Necklace_gold" } },
  { id: "res_arthur", name: "Arthur Pemberton", group: "resident", note: "91, ex-RAF, rollator",
    hash: { ...OldM("light"), hair: "Balding_white", mustache: "Mustache_white", clothes: "Longsleeve_2_Buttoned_white", overalls: "Suspenders_navy", neck: "Necktie_navy", legs: "Pants_charcoal", shoes: "Basic_Shoes_black" } },
  { id: "res_raj", name: "Raj Sandhu", group: "resident", note: "79, post-stroke, wheelchair",
    hash: { ...OldM("bronze"), hair: "Short_Topknot_white", beard: "Winter_Beard_white", clothes: "Longsleeve_2_VNeck_gray", legs: "Pants_charcoal", shoes: "Slippers_brown", wheelchair: "Wheelchair_black" } },
  { id: "res_stan", name: "Stan Brooks", group: "resident", note: "82, ex-market trader, shuffling gait",
    hash: { ...OldM("light"), hair: "Unkempt_gray", clothes: "Longsleeve_2_maroon", neck: "Scarf_sky", legs: "Pants_brown", shoes: "Slippers_navy" } },
  { id: "res_dennis", name: "Dennis Hart", group: "resident", note: "87, bed-bound, pyjamas",
    hash: { ...OldM("light"), hair: "Balding_white", clothes: "Longsleeve_2_Buttoned_sky", legs: "Pants_sky", shoes: "Slippers_navy" } },

  // ---- Staff (data/personas/staff.json) ----
  { id: "stf_joanne", name: "Joanne Price", group: "staff", note: "wing manager",
    hash: { ...F("light"), hair: "Bob_chestnut", clothes: "Longsleeve_2_Buttoned_navy", legs: "Pants_charcoal", shoes: "Basic_Shoes_black", necklace: "Small_Beaded_Necklace_silver" } },
  { id: "stf_maria", name: "Maria Santos", group: "staff", note: "registered nurse",
    hash: { ...F("olive"), hair: "Bangs_bun_black", clothes: "Shortsleeve_Polo_navy", legs: "Pants_navy", shoes: "Basic_Shoes_black" } },
  { id: "stf_blessing", name: "Blessing Mensah", group: "staff", note: "senior carer",
    hash: { ...F("black"), hair: "Twists_straight_black", ...senior } },
  { id: "stf_dave", name: "Dave Collins", group: "staff", note: "senior carer, ex-army",
    hash: { ...M("light"), hair: "Buzzcut_dark_gray", ...senior } },
  { id: "stf_kasia", name: "Kasia Nowak", group: "staff", note: "care assistant",
    hash: { ...F("light"), hair: "High_ponytail_blonde", ...carer } },
  { id: "stf_aisha", name: "Aisha Rahman", group: "staff", note: "care assistant",
    hash: { ...F("taupe"), hair: "Ponytail2_black", ...carer } },
  { id: "stf_tom", name: "Tom Fletcher", group: "staff", note: "care assistant, 19",
    hash: { ...M("light"), hair: "Messy2_light_brown", ...carer } },
  { id: "stf_florin", name: "Florin Popescu", group: "staff", note: "care assistant, nights",
    hash: { ...M("light"), hair: "Parted_dark_brown", mustache: "Mustache_dark_brown", ...carer } },
  { id: "stf_bev", name: "Bev Harris", group: "staff", note: "activities coordinator",
    hash: { ...F("light"), hair: "Curly_long_redhead", clothes: "Cardigan_purple", legs: "Pants_black", shoes: "Basic_Boots_maroon", necklace: "Large_Beaded_Necklace_gold", facial_eyes: "Round_Glasses_maroon" } },
  { id: "stf_sanjay", name: "Sanjay Mehta", group: "staff", note: "receptionist",
    hash: { ...M("bronze"), hair: "Swoop_black", clothes: "Longsleeve_2_Buttoned_white", neck: "Necktie_navy", legs: "Pants_charcoal", shoes: "Basic_Shoes_black" } },
  { id: "stf_lucy", name: "Lucy Brennan", group: "staff", note: "bank care assistant",
    hash: { ...F("light"), hair: "Bob_side_part_light_brown", ...carer } },
  { id: "stf_shanice", name: "Shanice Clarke", group: "staff", note: "bank care assistant",
    hash: { ...F("brown"), hair: "Cornrows_black", ...carer } },

  // ---- Visitors (data/personas/visitors.json) ----
  { id: "vis_linda", name: "Linda Carter", group: "visitor", note: "62",
    hash: { ...F("light"), hair: "Lob_ash", clothes: "Longsleeve_2_Scoop_teal", legs: "Pants_navy", shoes: "Revised_Shoes_brown", neck: "Scarf_rose" } },
  { id: "vis_mick", name: "Mick Carter", group: "visitor", note: "64",
    hash: { ...M("light"), hair: "Balding_gray", clothes: "Longsleeve_Polo_forest", legs: "Pants_tan", shoes: "Basic_Shoes_brown" } },
  { id: "vis_gary", name: "Gary Holloway", group: "visitor", note: "58",
    hash: { ...M("light"), hair: "High_and_tight_gray", clothes: "TShirt_charcoal", legs: "Pants_blue", shoes: "Basic_Boots_brown" } },
  { id: "vis_chloe", name: "Chloe Carter", group: "visitor", note: "24",
    hash: { ...F("light"), hair: "Long_straight_blonde", clothes: "TShirt_Scoop_pink", legs: "Leggings_black", shoes: "Revised_Shoes_white" } },
  { id: "vis_funmi", name: "Funmi Adeyemi", group: "visitor", note: "58",
    hash: { ...F("black"), hair: "Bangs_bun_black", clothes: "Longsleeve_2_VNeck_orange", legs: "Pants_brown", shoes: "Basic_Shoes_black" } },
  { id: "vis_tunde", name: "Tunde Adeyemi", group: "visitor", note: "55",
    hash: { ...M("brown"), hair: "Buzzcut_dark_gray", clothes: "Longsleeve_2_Buttoned_sky", legs: "Pants_gray", shoes: "Basic_Shoes_black" } },
  { id: "vis_kayode", name: "Kayode Adeyemi", group: "visitor", note: "19",
    hash: { ...M("black"), hair: "Twists_fade_black", clothes: "TShirt_red", legs: "Pants_black", shoes: "Revised_Shoes_white" } },
  { id: "vis_grace", name: "Sister Grace Oyelaran", group: "visitor", note: "71, church visitor",
    hash: { ...OldF("black"), headcover: "Kerchief_white", hair: "Afro_white", clothes: "Longsleeve_2_Buttoned_white", legs: "Pants_navy", shoes: "Basic_Shoes_black", necklace: "Small_Beaded_Necklace_gold" } },
  { id: "vis_colin", name: "Colin Pemberton", group: "visitor", note: "63",
    hash: { ...M("light"), hair: "Parted_2_gray", facial_eyes: "Glasses_black", clothes: "Longsleeve_2_VNeck_navy", legs: "Pants_charcoal", shoes: "Basic_Shoes_brown" } },
  { id: "vis_bernard", name: "Bernard Hughes", group: "visitor", note: "90",
    hash: { ...OldM("light"), hair: "Balding_white", mustache: "Walrus_Mustache_white", hat: "Formal_Bowler_Hat_black", facial_eyes: "Halfmoon_Glasses_black", clothes: "Cardigan_brown", legs: "Pants_gray", shoes: "Basic_Shoes_black" } },
  { id: "vis_hannah", name: "Hannah Ward", group: "visitor", note: "34",
    hash: { ...F("light"), hair: "Pixie_dark_brown", clothes: "Longsleeve_2_forest", legs: "Pants_blue", shoes: "Basic_Boots_black" } },
  { id: "vis_kuldip", name: "Kuldip Kaur Sandhu", group: "visitor", note: "76",
    hash: { ...OldF("bronze"), hair: "Bangs_bun_gray", clothes: "Longsleeve_2_Scoop_maroon", legs: "Pants_white", neck: "Scarf_pink", shoes: "Sandals_brown" } },
  { id: "vis_harpreet", name: "Harpreet Sandhu", group: "visitor", note: "52",
    hash: { ...M("bronze"), hair: "Short_Topknot_black", beard: "Basic_Beard_black", clothes: "Longsleeve_2_Buttoned_blue", legs: "Pants_charcoal", shoes: "Basic_Shoes_black" } },
  { id: "vis_simran", name: "Simran Sandhu", group: "visitor", note: "48",
    hash: { ...F("bronze"), hair: "Braid_black", clothes: "Longsleeve_2_Scoop_teal", legs: "Pants_white", neck: "Scarf_teal", shoes: "Sara_Shoes_black" } },
  { id: "vis_arjun", name: "Arjun Sandhu", group: "visitor", note: "12",
    hash: { ...base("teen", "bronze", "Human_Male_Small"), hair: "Short_Topknot_black", clothes: "TShirt_blue", legs: "Pants_navy", shoes: "Revised_Shoes_white" } },
  { id: "vis_priya", name: "Priya Sandhu", group: "visitor", note: "9",
    hash: { ...Girl("bronze"), hair: "Relm_Short_black", clothes: "TShirt_pink", legs: "Leggings_lavender", shoes: "Revised_Shoes_white" } },
  { id: "vis_maureen", name: "Maureen Brooks", group: "visitor", note: "74",
    hash: { ...OldF("light"), hair: "Curly_short_2_platinum", clothes: "Longsleeve_2_Buttoned_lavender", legs: "Pants_gray", shoes: "Revised_Shoes_black", necklace: "Small_Beaded_Necklace_gold" } },
  { id: "vis_tracey", name: "Tracey Brooks", group: "visitor", note: "58",
    hash: { ...F("light"), hair: "Lob_blonde", clothes: "TShirt_VNeck_maroon", legs: "Pants_black", shoes: "Basic_Boots_black" } },
  { id: "vis_sheila", name: "Sheila Turner", group: "visitor", note: "80",
    hash: { ...OldF("light"), hair: "Bob_side_part_white", facial_eyes: "Halfmoon_Glasses_maroon", clothes: "Cardigan_teal", legs: "Pants_charcoal", shoes: "Basic_Shoes_brown" } },
  { id: "vis_terry", name: "Terry Mills", group: "visitor", note: "81",
    hash: { ...OldM("light"), hair: "Parted_white", facial_eyes: "Glasses_black", clothes: "Longsleeve_Polo_navy", legs: "Pants_tan", shoes: "Basic_Shoes_brown" } },
  { id: "vis_sarah", name: "Sarah Evans", group: "visitor", note: "61",
    hash: { ...F("light"), hair: "Wavy_ash", clothes: "Longsleeve_2_Scoop_navy", legs: "Pants_gray", shoes: "Revised_Shoes_black", neck: "Scarf_red" } },
  { id: "vis_paul", name: "Paul Hart", group: "visitor", note: "58",
    hash: { ...M("light"), hair: "Plain_gray", beard: "Trimmed_Beard_gray", clothes: "Longsleeve_2_bluegray", legs: "Pants_blue", shoes: "Basic_Boots_brown" } },
  { id: "vis_mia", name: "Mia Evans", group: "visitor", note: "30",
    hash: { ...F("light"), hair: "Long_messy_chestnut", clothes: "Cardigan_yellow", legs: "Leggings_charcoal", shoes: "Basic_Boots_tan" } },
  { id: "vis_pat", name: "Pat Doyle", group: "visitor", note: "83",
    hash: { ...OldF("light"), hair: "Pixie_white", facial_eyes: "Halfmoon_Glasses_black", clothes: "Cardigan_lavender", legs: "Pants_navy", shoes: "Basic_Shoes_navy" } },
  { id: "vis_father_michael", name: "Father Michael O'Connell", group: "visitor", note: "66, priest",
    hash: { ...M("light"), hair: "Parted_3_gray", clothes: "Longsleeve_2_Buttoned_black", legs: "Pants_black", shoes: "Basic_Shoes_black" } },

  // ---- Extras (not in the persona files; new for director scenarios / visiting professionals) ----
  { id: "ext_agency_carer", name: "Precious Moyo", group: "extra", agency: true, note: "agency care assistant",
    hash: { ...F("black"), hair: "Dreadlocks_short_black", clothes: "Shortsleeve_Polo_all.lpcr.pink", legs: "Pants_all.lpcr.pink", shoes: "Basic_Shoes_black" } },
  { id: "ext_gp", name: "Dr Rachel Moore", group: "extra", note: "visiting GP",
    hash: { ...F("light"), hair: "Bob_dark_brown", facial_eyes: "Glasses_black", clothes: "Longsleeve_2_Buttoned_white", legs: "Pants_charcoal", shoes: "Revised_Shoes_black" } },
  { id: "ext_district_nurse", name: "Gemma Walsh", group: "extra", note: "district nurse",
    hash: { ...F("light"), hair: "High_ponytail_chestnut", clothes: "Shortsleeve_Polo_sky", legs: "Pants_navy", shoes: "Basic_Shoes_black" } },
  { id: "ext_chef", name: "Kwame Boateng", group: "extra", note: "chef",
    hash: { ...M("brown"), hair: "Buzzcut_black", clothes: "Longsleeve_2_Buttoned_white", legs: "Pants_black", shoes: "Basic_Shoes_black" } },
  { id: "ext_housekeeper", name: "Ana Ferreira", group: "extra", note: "housekeeper",
    hash: { ...F("olive"), hair: "Bangs_bun_dark_brown", clothes: "Shortsleeve_Polo_green", legs: "Pants_black", shoes: "Basic_Shoes_black" } },
  { id: "ext_maintenance", name: "Keith Barnes", group: "extra", note: "maintenance",
    hash: { ...M("light"), hair: "Balding_gray", clothes: "TShirt_gray", overalls: "Overalls_navy", shoes: "Basic_Boots_black" } },
  { id: "ext_hairdresser", name: "Jade Morgan", group: "extra", note: "visiting hairdresser",
    hash: { ...F("amber"), hair: "Long_center_part_pink", clothes: "TShirt_black", legs: "Leggings_black", shoes: "Basic_Boots_black" } },

  // ---- Added 2026-09-29: night cover, on-call and agency clinicians, paramedics ----
  { id: "ext_night_float", name: "Lorna Mitchell", group: "extra", note: "floating night carer",
    hash: { ...F("light"), hair: "Ponytail_dark_brown", ...carer } },
  { id: "ext_oncall_rn", name: "On-call nurse", group: "extra", note: "on-call registered nurse",
    hash: { ...M("brown"), hair: "Parted_black", clothes: "Shortsleeve_Polo_navy", legs: "Pants_navy", shoes: "Basic_Shoes_black" } },
  { id: "ext_agency_carer_m", name: "Agency carer (male)", group: "extra", agency: true, note: "agency care assistant",
    hash: { ...M("taupe"), hair: "Buzzcut_black", beard: "Trimmed_Beard_black", clothes: "Shortsleeve_Polo_all.lpcr.pink", legs: "Pants_all.lpcr.pink", shoes: "Basic_Shoes_black" } },
  { id: "ext_agency_nurse", name: "Agency nurse", group: "extra", agency: true, note: "agency registered nurse",
    hash: { ...F("light"), hair: "Wavy_ginger", clothes: "Shortsleeve_Polo_all.lpcr.pink", legs: "Pants_navy", shoes: "Basic_Shoes_black" } },
  { id: "ext_paramedic_m", name: "Paramedic (male)", group: "extra", note: "ambulance paramedic",
    hash: { ...M("bronze"), hair: "High_and_tight_black", ...paramedic } },
  { id: "ext_paramedic_f", name: "Paramedic (female)", group: "extra", note: "ambulance paramedic",
    hash: { ...F("brown"), hair: "High_ponytail_black", ...paramedic } },

  // ---- Added 2026-09-30: draft admission (data/personas/admissions.json, adm_kamala) ----
  // Salwar kameez approximated: there's no animated tunic and only one top slot, so a soft grey cardigan
  // covers the kameez, with the lilac suit showing as the dupatta (scarf) and salwar (pantaloons).
  // No walking stick in the sheet: the sim draws it as an overlay (the generator's Cane only has walk and thrust art).
  { id: "res_kamala", name: "Kamala Shah", group: "resident", note: "85, walking stick (drawn by the sim as an overlay); draft admission",
    hash: { ...OldF("taupe"), hair: "Bangs_bun_gray", facial_eyes: "Glasses_gold", clothes: "Cardigan_all.lpcr.dove", neck: "Scarf_all.lpcr.lavender", legs: "Pantaloons_all.lpcr.lavender", shoes: "Basic_Shoes_brown" } },
  // Kamala's visitors, from the same admission card (names and ages as on the card).
  // No animated kurti, coat, jacket or hoodie exists: Hema's cardigan and scarf stand in for kurti and coat,
  // and Kiran's plain sweatshirt stands in for a hoodie (the Hood hat reads as a cloak and hides his hair).
  { id: "vis_hema", name: "Hema Mistry", group: "visitor", note: "58, Kamala's daughter",
    hash: { ...F("taupe"), hair: "Lob_lpcr.charcoal", facial_eyes: "Glasses_black", clothes: "Cardigan_navy", neck: "Scarf_maroon", legs: "Pants_black", shoes: "Basic_Shoes_black" } },
  { id: "vis_kiran", name: "Kiran Mistry", group: "visitor", note: "24, Kamala's grandson",
    hash: { ...M("taupe"), hair: "Side_Swoop_black", clothes: "Longsleeve_2_charcoal", legs: "Pants_blue", shoes: "Revised_Shoes_white" } },

  // ---- Added 2026-09-30: cover from the main building ----
  // Built to contrast with Lorna (51) and the wing's carers: male body, plump head, olive skin, balding with a beard.
  // (No top with all four animations fits the muscular body, so the polo limits builds to male, female and teen.)
  { id: "ext_main_carer", name: "Nikos Georgiou", group: "extra", note: "care assistant from the main building, covers the wing",
    hash: { ...base("male", "olive", "Human_Male_Plump"), hair: "Balding_dark_brown", beard: "Basic_Beard_dark_brown", ...carer } },
];

// Eye colours other than the brown default.
const eyeOverrides = {
  res_peggy: "blue", res_arthur: "gray", res_stan: "blue", res_dennis: "gray",
  stf_kasia: "blue", stf_tom: "green", stf_florin: "gray", stf_bev: "green", stf_lucy: "blue",
  vis_linda: "blue", vis_mick: "gray", vis_chloe: "blue", vis_hannah: "green", vis_maureen: "blue",
  vis_tracey: "blue", vis_sheila: "gray", vis_sarah: "green", vis_mia: "green", vis_pat: "blue",
  vis_father_michael: "blue", ext_district_nurse: "green", ext_maintenance: "gray",
  ext_night_float: "blue", ext_agency_nurse: "green",
};
for (const c of characters) if (eyeOverrides[c.id]) c.hash.eyes = `Eye_Color_${eyeOverrides[c.id]}`;
