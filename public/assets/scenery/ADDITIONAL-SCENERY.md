# Additional scenery to capture — rownative course pass

A pass over **all 169 rownative courses** (61 venues), recording the scenery the
current 114-model catalogue (see [README.md](README.md), issue #216) does **not**
yet cover, plus specs for three new crew/craft models: a **female rower**, a
**male rower**, and the **single scull** they row.

Sources reconciled this pass:
- `raw.githubusercontent.com/rownative/courses/main/courses/index.json` → 169 courses ✓
- `rownative.icu/api/courses` → 169 courses ✓ (same IDs)
- Issue #216 appendices — 184 hero landmarks, venue→archetype, venue→biome.

The 169 courses collapse to **61 venues**; 44 of them carry named, close-in
structures. The generic kit (Tiers A–F, all built) dresses every venue's
*biome*; what is missing is the **place-specific hero fabric** and a short list
of **archetypes the survey found but the 114 set never modelled**.

Conventions are unchanged from #216 (mm in CadQuery, Z = 0 at the waterline,
+Y faces the water, per-face flat hex, STEP + GLB + LOD) **except the crew/craft
models in §4, which are authored in metres** to drop straight into the boat slot.

---

## 1. Archetype gaps — new generic models (Tier G)

Surveyed within 1.2 km of rowed water but absent from the 114-model catalogue.
Each is reusable across every venue that has the feature, so build these before
any one-off.

| id | Description | Dimensions (m) | Palette | Seen at (venues) |
|---|---|---|---|---|
| `g01-skyscraper-tower` | Near-field downtown high-rise: parameterised curtain-wall slab, plant deck, setback crown. Height 60–180 m. **26 surveyed at Cleveland, plus Boston, Turin.** | 24 × 24 × 60–180 | Glass `#3A4E5A`, mullions `#8A8E96`, crown `#B0B4B8` | Head of the Cuyahoga, Cambridge, D'Inverno sul Po |
| `g02-bridge-double-decker` | Two-level truss/arch crossing, road over rail, lattice between decks. **Detroit–Superior / Voinovich type.** | 120 × 14 × 22 | Steel `#5A5F66`, deck `#B0ACA4` |  Head of the Cuyahoga |
| `g03-bridge-pipeline` | Utility pipe bridge on a light trestle, insulated pipe run, walkway rail. | 45 × 3 × 6 | Pipe `#8A8272`, trestle `#5A6068` | Tees, Avon (Preston/Newbridge/Highnams) |
| `g04-bridge-tram` | Light-rail viaduct deck on slim piers, catenary masts and wire. | 60 × 8 × 10 | Concrete `#B0ACA4`, masts `#4A4E52` | Brno |
| `g05-footbridge-timber` | Simple timber beam footbridge, handrails both sides, mid pier. | 24 × 2.4 × 4 | Timber `#8B7355`, rail `#B8AFA0` | Dorney (Summerleaze), NL parks |
| `g06-dam-gravity-concrete` | Large concrete gravity dam with a stepped spillway, crest walkway, sluice gates and stilling basin. | 120 × 20 × 24 | Concrete `#B5B0A6`, wet `#6E6E68`, gates `#3A4048` | Hoover Res., Brno, Cooper R., Carnegie, Mashpee |
| `g07-lighthouse-harbour` | Squat harbour light: white tower on a pier base, gallery, red lantern housing. | dia 4 × 12 | Tower `#F2F2F0`, lantern `#C8102E`, base `#5A5F66` | Oakland Estuary |
| `g08-windmotor-steel` | Dutch steel wind pump: open lattice tower, many-bladed fan wheel, tail vane. Distinct from the thatched `d-nl-02`. | dia 5 × 14, wheel dia 5 | Steel `#8A9096`, vane `#C8102E` | Heerenveens Kanaal (Windmotor Nieuwebrug) |
| `g09-power-station-stack` | Riverside power/plant hall with a tall round flue stack and banked louvres. | 40 × 24 × 20, stack dia 4 × 45 | Brick/clad `#7A6E60`, stack `#B0ACA4` w/ `#8A4A2E` band | 2K (UMass Medical), Head of Prague (Svornosti) |
| `g10-observation-tower` | Slender viewing/heritage tower: masonry or concrete shaft, cantilevered viewing deck, mast. | dia 6 × 28 | Concrete `#B5B0A6` or stone `#A89E8C`, rail `#3E4348` | Head of Prague (Barrandov), Cambridge Cam (Chesterton) |
| `g11-water-tower-masonry` | European brick/render water tower: tapered shaft, corbelled tank drum, conical roof. Old-world counterpart to the steel `d-us-05`. | dia 10 × 32 | Brick `#8B4A3A`, tank `#A89E8C`, roof `#3E4A52` | DDS Trial (Delft Watertoren) |
| `g12-islet-sandy-scrub` | Low, flat lagoon/estuary islet: sand-and-scrub with no tall canopy, rock rim. The Foster City "Isles" and Mission Bay "Ski Islands" type — distinct from the wooded `f16`. | 30 × 15 × 3 | Sand `#D8C89E`, scrub `#5E7A46`, rim `#A89E8E` | Foster City Lagoon, Mission Bay |

### Tier E vegetation gap

| id | Description | Height (m) | Palette | Region |
|---|---|--:|---|---|
| `e15-palm` | Coconut/queen palm: clean ringed trunk, radiating frond crown. #216's Tier E had no warm-climate tree, yet the `beach` profile plants `palm`. | 12 | Trunk `#9A8464`, fronds `#3E6B32` | Mission Bay, Florida (NBP, Battle of the Bridges) |

---

## 2. Hero landmark register — how to capture the 184

The full register (184 named structures, coordinates, kinds, distances) is
issue #216 **Appendix 1**. It does **not** need 184 bespoke models. Sorting it by
what a rower actually needs:

**~150 are liveried reskins of models that already exist.** Bridges → `c01`–`c08`
and `g02`–`g05`; boathouses/rowing clubs → `b01`/`b02`/`b03`; churches/chapels →
`d-gb-02`/`d-ce-01`; stations → `rail-station` (build from `d-us`/`d-gb` kit);
mills → `d-us-02`/`d-nl-02`; islands → `f16`/`g12`; monuments/memorials →
`monument`; villas/palazzi/castles → `d-ce-03`/`d-it-01`/`d-it-02`. Capture these
by **placing the archetype at the Wikidata coordinate and applying the venue's
palette** — no new geometry.

**Liveries to honour when reskinning** (from the register; build to these, not the
neutral tier palette):

| Structure | Venue | Livery |
|---|---|---|
| Barnes Railway Bridge | The Boat Race | green with gold detail |
| Chiswick Bridge | The Boat Race | pale Portland-stone concrete |
| Fremont Bridge | Head of the Lake (Seattle) | orange & blue bascule |
| George Washington Memorial Bridge | Head of the Lake | steel cantilever (`c08`) |
| Ponte Isabella | D'Inverno sul Po (Turin) | pale ashlar stone arch |
| Crook Point Bascule Bridge | Gingerbread (Seekonk) | rusted, permanently raised leaf (`c05`) |
| Hope Memorial / Detroit–Superior | Head of the Cuyahoga | grey stone pylons / double deck (`g02`) |

**~14 warrant bespoke one-off models** — big, singular, and read instantly:

| One-off | Venue | Build as |
|---|---|---|
| Castello del Valentino | Turin | **already built** — `d-it-02` ✓ |
| De Salamander windmill | Leiden (Kerstwedstrijd) | **already built** — `d-nl-02` ✓ |
| Boston Manufacturing Co. mill | Upper Charles (Waltham) | **already built** — `d-us-02` ✓ |
| Hoover Dam (Ohio) | Hoover Reservoir | `g06` |
| Brno Dam + road bridge on the crest | Brno | `g06` + `c02` |
| Oakland Harbor Light | Oakland Estuary | `g07` |
| Barrandov Terraces | Head of Prague | `g10` |
| Cleveland downtown cluster | Head of the Cuyahoga | `g01` ×3–5 + `g02` |
| Detroit–Superior Bridge | Head of the Cuyahoga | `g02` |
| Fremont Bridge | Head of the Lake | `c05` in the orange/blue livery |
| Sesquicentennial Pylons | House of Wines | `monument` (tall paired pylons) |
| Stonehaven Tolbooth | CCRC (Aberdeenshire) | `d-gb-04` cluster + harbour quay `b05` |
| Venice Seaboard Air Line Station | Battle of the Bridges | `rail-station` in Florida mission style |
| Watertoren (Delft) | DDS Trial | `g11` |

**5 venues have no Wikidata fabric at all** (Fish Creek, NBP/Nathan Benderson,
Bush R., and the two Scottish sea/loch CCRC courses) — dress from Tier A + Tier E
+ Tier F only, per #216.

---

## 3. Suggested capture order

1. **Tier G archetype gaps** (`g01`–`g12`, `e15`) — reusable, unblock the most venues.
2. **Liveried bridge reskins** — Barnes, Chiswick, Fremont, Ponte Isabella, GW Memorial; bridges are the one thing a rower goes *through*.
3. **The ~11 remaining bespoke one-offs** (`g06`/`g07`/`g10` heroes; Cleveland cluster).
4. **Placement pass** — drop every Appendix-1 landmark at its coordinate against the course polyline, archetype + livery, nearest-first.

Net new geometry: **13 generic models + ~11 bespoke one-offs = ~24 models**, on
top of the 114 already built — everything else in the register is placement.

---

## 4. Crew & craft — new hero models (Tier H)

The scene already reserves a slot for a rigged sculling boat with an animated
rower: [`public/assets/boat/README.md`](../boat/README.md) defines the required
node names and bounds, and the procedural `RowingScull` in
`src/components/rower3d/boatComponents.tsx` defines the motion these nodes must
support. Build to that contract exactly.

**Authored in METRES** (not mm): the boat loader consumes the GLB at true scale,
so a 1-unit = 1-metre model drops in without an importer step. Pivot at the
hull's geometric centre at the waterline (**Y = 0**), bow toward **+Z**.

### Required node tree (all three models share it)

```
Hull
Seat                 slides on Z, travel ≈ ±0.25 m (0.5 m stroke), seat top Y ≈ 0.18
LeftRigger, RightRigger
LeftOar, RightOar    pivot at (±0.30, 0.15, 0.50) from hull centre; sweep ±0.5 rad about Y
Rower                root; rides with the seat
  Rower_Torso        body rock / layback
  Rower_LeftArm, Rower_RightArm    draw to the finish
  Rower_LeftLeg, Rower_RightLeg    leg drive
```

Animation is driven by `strokeCycleT` (0–1) from the physics engine:
`oarSweep = sin(strokeCycleT·2π)·0.5`; seat and body follow the same phase. Model
the **catch** as the neutral pose (shins vertical, arms extended to the toes,
body forward) so the drive/recovery animate cleanly from it.

### `h01-single-scull` — the boat

| Part | Spec | Palette |
|---|---|---|
| Hull | Fine racing shell, 8.2 m × 0.28 m beam × 0.20 m deep, waterline knife-edge, open cockpit with foot-stretcher and sax-boards, tapered bow/stern. | Deck `#E8E4D8` (matches the current procedural hull), below-water `#1E2A33`, cockpit `#2A2A28` |
| Seat | Moulded sliding seat on twin rails/wheels; its own `Seat` node so the engine can translate it in Z. | Seat `#3E4348`, rails `#C8CCD0` |
| Riggers | Aluminium tube wing/2-stay riggers, oarlock gate at each pivot; span so the gates sit at ±0.85 m from the hull centreline. | Alu `#C8CCD0`, gate `#1A1A1A` |
| Oars (sculling pair) | Two spoon/hatchet sculls, loom 2.88 m, blade 0.46 × 0.25 m, handle inboard. Each is one `LeftOar`/`RightOar` group so it rotates about the gate. | Shaft `#F2F2F0`, blade a livery colour (default `#C8102E`), collar `#1A1A1A` |

Bounds check (from the boat README): length 8.0–8.4 m, beam 0.25–0.35 m, hull
height 0.15–0.25 m. Budget 20k–80k tris for the whole crewed model; ship a
`_lod2` at ≤ 2k for distant boats. Export STEP master (hull/rigger) + GLB.

### `h02-rower-male` and `h03-rower-female` — the crew

Seated rowing figures that fill the `Rower` node and its five sub-chains. Deliver
each as a **complete crewed scull GLB** (`scull-male.glb`, `scull-female.glb`)
containing every node above, plus a bare `scull.glb` for future custom crews.

| Attribute | `h02-rower-male` | `h03-rower-female` |
|---|---|---|
| Stature (standing ref) | 1.86 m | 1.74 m |
| Build | broader shoulders, longer levers | narrower shoulders, proportionally similar leg drive |
| Torso segment (hip→shoulder) | 0.62 m | 0.56 m |
| Upper / lower arm | 0.34 / 0.30 m | 0.31 / 0.27 m |
| Thigh / shin | 0.46 / 0.44 m | 0.43 / 0.41 m |
| Kit | one-piece rowing suit (unisuit), racing-back cut | one-piece rowing suit, racing-back cut |

Shared spec:
- **Segmented for the rig**: separate `Rower_Torso`, arm and leg chains hinged at
  shoulder/elbow and hip/knee so the drive (legs → back → arms) and recovery read
  correctly; hands meet the oar handles at the finish.
- **Palette** (neutral placeholders — swap for a club kit): suit `#1E3A5F` navy
  with `#F2F2F0` racing stripe, skin a neutral mid `#C9A184` (ship light/mid/deep
  variants), hair `#2A2320`, hands on handles. No logos.
- **Budget**: ~8–15k tris each within the combined boat budget; `_lod2` ≤ 1k
  (single blended body, seated pose).
- Feet fixed to the stretcher (do not slide); the whole `Rower` root translates
  with the `Seat` while the leg chain compresses at the catch.

Both figures are the same rig at different proportions — build one, then retarget
the segment lengths above for the second, so the animation binding is identical.

---

## 5. Tally

- **Additional generic archetypes:** 13 (`g01`–`g12`, `e15`).
- **Bespoke hero one-offs still to build:** ~11 (3 of the notable ones already exist).
- **Crew & craft:** 3 (`h01` scull, `h02` male rower, `h03` female rower) → delivered as 2 crewed GLBs + 1 bare hull.
- **Everything else in the 184-landmark register:** placement of existing archetypes at surveyed coordinates, with the liveries in §2.
