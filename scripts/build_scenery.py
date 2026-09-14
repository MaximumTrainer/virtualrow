"""
Colour-aware batch builder for virtualrow scenery assets (issue #216).
Each model is a list of (cadquery object, hex colour) parts.
Exports coloured GLB + STEP, renders a coloured multi-view PNG.
All dims in mm; Z=0 at waterline contact; +Y faces water; centred on X/Y.
"""
import cadquery as cq
import sys, os, math, traceback, tempfile
from pathlib import Path
import numpy as np

OUTPUT_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("./output")
ONLY = set(sys.argv[2:]) if len(sys.argv) > 2 else None
RENDERS_DIR = OUTPUT_DIR / "renders"
for d in (OUTPUT_DIR, RENDERS_DIR):
    d.mkdir(parents=True, exist_ok=True)


def hx(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


def to_shape(obj):
    """Accept a Workplane or Shape, return a Shape."""
    return obj.val() if isinstance(obj, cq.Workplane) else obj


def build_assembly(parts):
    a = cq.Assembly()
    for i, (obj, color_hex) in enumerate(parts):
        r, g, b = hx(color_hex)
        a.add(to_shape(obj), name=f"part{i}", color=cq.Color(r, g, b))
    return a


def tessellate_part(obj):
    """Export a single part to STL and load vertices/faces via trimesh."""
    import trimesh
    with tempfile.NamedTemporaryFile(suffix='.stl', delete=False) as f:
        tmp = f.name
    try:
        cq.exporters.export(to_shape(obj), tmp, cq.exporters.ExportTypes.STL,
                            tolerance=0.1, angularTolerance=0.2)
        m = trimesh.load(tmp, force='mesh')
        return np.array(m.vertices), np.array(m.faces)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def render_png(parts, name, dims_label=""):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    tess = []
    all_v = []
    for obj, color_hex in parts:
        v, f = tessellate_part(obj)
        if len(v) == 0 or len(f) == 0:
            continue
        tess.append((v, f, hx(color_hex)))
        all_v.append(v)
    if not all_v:
        print(f"  WARNING: nothing to render for {name}")
        return None
    allv = np.vstack(all_v)
    mins, maxs = allv.min(axis=0), allv.max(axis=0)
    center = (mins + maxs) / 2
    span = (maxs - mins).max() / 2 * 1.15
    if span == 0:
        span = 1.0

    views = [("Front", 8, -88), ("Right", 8, 2), ("Top", 89, -90), ("Iso", 26, -52)]
    light = np.array([0.4, 0.5, 0.75]); light = light / np.linalg.norm(light)

    fig, axes = plt.subplots(1, 4, figsize=(22, 5.5), subplot_kw={'projection': '3d'})
    fig.suptitle(f"{name}    {dims_label}", fontsize=15, fontweight='bold')

    for ax, (label, elev, azim) in zip(axes, views):
        for v, f, col in tess:
            polys = v[f]
            n = np.cross(polys[:, 1] - polys[:, 0], polys[:, 2] - polys[:, 0])
            nn = np.linalg.norm(n, axis=1, keepdims=True); nn[nn == 0] = 1
            n = n / nn
            inten = 0.45 + 0.55 * np.abs(n @ light)
            fc = np.column_stack([np.clip(inten * col[0], 0, 1),
                                  np.clip(inten * col[1], 0, 1),
                                  np.clip(inten * col[2], 0, 1),
                                  np.ones(len(inten))])
            pc = Poly3DCollection(polys, facecolors=fc, edgecolors='none')
            pc.set_sort_zpos(0)
            ax.add_collection3d(pc)
        ax.set_xlim(center[0] - span, center[0] + span)
        ax.set_ylim(center[1] - span, center[1] + span)
        ax.set_zlim(center[2] - span, center[2] + span)
        ax.set_box_aspect((1, 1, 1))
        ax.view_init(elev=elev, azim=azim)
        ax.set_title(label, fontsize=10)
        ax.set_xlabel('X'); ax.set_ylabel('Y'); ax.set_zlabel('Z (up)')
        ax.grid(True, alpha=0.3)

    plt.tight_layout()
    p = RENDERS_DIR / f"{name}.png"
    fig.savefig(str(p), dpi=140, bbox_inches='tight', facecolor='#f4f5f6')
    plt.close(fig)
    print(f"  PNG:  {p}")
    return p


def export_all(parts, name, tier):
    tier_dir = OUTPUT_DIR / f"tier-{tier}"
    tier_dir.mkdir(parents=True, exist_ok=True)
    a = build_assembly(parts)
    glb = tier_dir / f"{name}.glb"
    step = tier_dir / f"{name}.step"
    a.export(str(glb))
    a.export(str(step))
    print(f"  GLB:  {glb}")
    print(f"  STEP: {step}")


def build(name, tier, dims_label, parts):
    print(f"\n{'='*64}\n{name}\n{'='*64}")
    try:
        # bbox from union of all shapes
        comp = cq.Compound.makeCompound([to_shape(o) for o, _ in parts])
        bb = comp.BoundingBox()
        print(f"  BBox: {bb.xlen:.0f} x {bb.ylen:.0f} x {bb.zlen:.0f} mm")
        render_png(parts, name, dims_label)
        export_all(parts, name, tier)
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        traceback.print_exc()
        return False


# ============================================================
# Colour palette (hex from issue #216, adjusted per real-world notes)
# ============================================================
BUOY_RED   = "#E8452B"; WHITE = "#F2F2F0"; BUOY_YEL = "#F5B32D"; BLACK = "#1A1A1A"
DECK_TIMB  = "#9C8465"; FLOAT_DK = "#3A3F44"; CLEAT = "#8A9096"
TIMBER     = "#8B7355"; PILE = "#4A3B2A"; RAIL_PALE = "#B8AFA0"
DECK_PALE  = "#A89070"; POST_PALE = "#D8D4CC"
FRAME_CREAM= "#E6E2D8"; ROOF_SLATE = "#3E4A52"; GLAZE = "#2A3A44"
POST_GREY  = "#5A5A55"; DIGITS = "#1A1A1A"
HULL_WHITE = "#F2F2F0"; HULL_TRIM = "#1E3A5F"; ENGINE = "#2A2A2A"
GAZ_POST   = "#E8E4DA"; GAZ_ROOF = "#5C4A3A"; GAZ_PLINTH = "#8A8577"
CONCRETE   = "#B5B0A6"; ALGAE = "#4A5E3E"
RAIL_DARK  = "#3E4348"; FLAG_RED = "#C8102E"
CLAP_NE    = "#C9BFA8"; ROOF_NE = "#4A3F35"; BAY_DK = "#241E18"; BALC = "#F0EDE4"
BRICK_UK   = "#8B4A3A"; TIMBER_UK = "#3E2E22"; RENDER_UK = "#E8E0D0"; SLATE_UK = "#4A4E54"
BLOCK_MOD  = "#B8B4AC"; GLAZE_MOD = "#3A4E5A"; FASCIA_MOD = "#D8D4CC"
FRAME_STL  = "#5A6068"
BR_CONC    = "#B0ACA4"; BR_RAIL = "#6E7378"
STONE_ARCH = "#A79E8E"; VOUSS = "#8E8577"; PARAPET = "#B8B0A0"
GIRDER     = "#3A4048"; ABUT_STONE = "#8E8577"
SOIL       = "#6B5540"; ROOT = "#4A3B2A"; GRASSLIP = "#5E8A46"
SHINGLE    = "#A89E8E"; WETBAND = "#6E6558"
SILT       = "#5A5140"; REED = "#A89A6E"
STONE_WALL = "#9A9184"; COPING = "#B5AE9E"; ALGAE2 = "#3E5A3E"
GRASS      = "#5E8A46"; GRASS_DRY = "#A89A5E"
ROCK       = "#7E7A72"; MOSS = "#4A6B3A"
REED_HEAD  = "#C8BC9A"
BRAMBLE    = "#41663A"; BR_STEM = "#6E5A42"
BENCH_SLAT = "#8B7355"; BENCH_END = "#3E4348"


# ============================================================
# TIER A - universal rowing furniture (all 12)
# ============================================================
def a01():
    # Lane buoy: flattened sphere, red. (Albano: colour varies by distance;
    # red is the start/finish-zone colour, the most recognisable — see PR notes.)
    s = cq.Workplane("XY").sphere(150)
    from OCP.gp import gp_GTrsf
    from OCP.BRepBuilderAPI import BRepBuilderAPI_GTransform
    gt = gp_GTrsf(); gt.SetValue(3, 3, 0.88)
    flat = cq.Shape(BRepBuilderAPI_GTransform(s.val().wrapped, gt, True).Shape())
    return "a", "dia 300mm", [(flat, BUOY_RED)]

def a02():
    parts = []
    body = cq.Workplane("XY").circle(300).extrude(900).translate((0, 0, -450))
    parts.append((body, BUOY_YEL))
    ribs = None
    for ang in range(0, 360, 45):
        r = cq.Workplane("XZ").rect(12, 900).extrude(305).translate((0, 0, -450)).rotate((0,0,0),(0,0,1),ang)
        ribs = r if ribs is None else ribs.union(r)
    parts.append((ribs, "#D89A1F"))
    band = cq.Workplane("XY").circle(302).extrude(120).translate((0,0,300))
    parts.append((band, BLACK))
    top = cq.Workplane("XY").circle(310).extrude(20).translate((0,0,450))
    parts.append((top, BLACK))
    eye = cq.Workplane("XY").circle(28).extrude(70).translate((0,0,470))
    parts.append((eye, "#5A5A55"))
    return "a", "dia 600 x 900mm", parts

def a03():
    parts = []
    deck = cq.Workplane("XY").box(6000, 2400, 80).translate((0,0,40))
    parts.append((deck, DECK_TIMB))
    for yo in (-700, 700):
        parts.append((cq.Workplane("XY").box(5800,500,300).translate((0,yo,-150)), FLOAT_DK))
    edge = (cq.Workplane("XY").box(6000,2400,30)
            .cut(cq.Workplane("XY").box(5940,2340,30)).translate((0,0,80)))
    parts.append((edge, FLOAT_DK))
    cleats = None
    for xo in (-2000,0,2000):
        for yo in (-1000,1000):
            c = cq.Workplane("XY").box(120,60,70).translate((xo,yo,115))
            cleats = c if cleats is None else cleats.union(c)
    parts.append((cleats, CLEAT))
    return "a", "6000 x 2400 x 450mm", parts

def a04():
    # Fixed timber landing stage on piles, 3 steps, handrail one side
    parts = []
    deck = cq.Workplane("XY").box(12000,3000,200).translate((0,0,1100))
    parts.append((deck, TIMBER))
    piles = None
    for xo in (-5000,-1600,1600,5000):
        for yo in (-1300,1300):
            p = cq.Workplane("XY").box(250,250,1300).translate((xo,yo,550))
            piles = p if piles is None else piles.union(p)
    parts.append((piles, PILE))
    steps = None
    for i in range(3):
        s = cq.Workplane("XY").box(2400,500,60).translate((0,1600+i*260,900-i*330))
        steps = s if steps is None else steps.union(s)
    parts.append((steps, TIMBER))
    railposts = None
    for xo in range(-5500,5501,1500):
        rp = cq.Workplane("XY").box(80,80,1000).translate((xo,-1450,1700))
        railposts = rp if railposts is None else railposts.union(rp)
    rail = cq.Workplane("XZ").box(11000,80,80).translate((0,-1450,2100))
    parts.append((railposts.union(rail), RAIL_PALE))
    return "a", "12000 x 3000 x 1200mm", parts

def a05():
    parts=[]
    deck = cq.Workplane("XY").box(3500,1400,100)
    parts.append((deck, DECK_PALE))
    for yo in (-400,400):
        parts.append((cq.Workplane("XY").box(3200,400,300).translate((0,yo,-250)), FLOAT_DK))
    platform = cq.Workplane("XY").box(1200,1000,60).translate((-800,0,80))
    parts.append((platform, DECK_TIMB))
    post = cq.Workplane("XY").circle(35).extrude(750).translate((1500,0,50))
    parts.append((post, POST_PALE))
    return "a", "3500 x 1400 x 800mm", parts

def a06():
    parts=[]
    posts=None
    for x in (-1300,1300):
        for y in (-1300,1300):
            p=cq.Workplane("XY").box(180,180,3200).translate((x,y,1600))
            posts=p if posts is None else posts.union(p)
    parts.append((posts, FRAME_CREAM))
    slab=cq.Workplane("XY").box(2900,2900,140).translate((0,0,3200))
    parts.append((slab, FRAME_CREAM))
    cabin=(cq.Workplane("XY").box(2900,2900,2600)
           .cut(cq.Workplane("XY").box(2640,2640,2600))
           .translate((0,0,4600)))
    window=cq.Workplane("XY").box(2500,220,1600).translate((0,1360,4900))
    cabin=cabin.cut(window)
    parts.append((cabin, FRAME_CREAM))
    parts.append((cq.Workplane("XY").box(2500,60,1600).translate((0,1360,4900)), GLAZE))
    roof=cq.Workplane("XY").box(3300,3300,120).translate((0,0,6000))
    parts.append((roof, ROOF_SLATE))
    stair=None
    for i in range(9):
        t=cq.Workplane("XY").box(600,280,50).translate((1500,0,i*380))
        stair=t if stair is None else stair.union(t)
    railp=cq.Workplane("XY").box(80,700,3400).translate((1620,0,1700))
    parts.append((stair.union(railp), FRAME_CREAM))
    return "a", "3000 x 3000 x 6500mm", parts

def a07():
    parts=[]
    parts.append((cq.Workplane("XY").box(80,60,2400).translate((0,0,1200)), POST_GREY))
    parts.append((cq.Workplane("XY").box(900,50,500).translate((0,5,2050)), WHITE))
    # "500" style digit bars
    parts.append((cq.Workplane("XY").box(600,10,60).translate((0,-20,2050)), DIGITS))
    return "a", "900 x 60 x 2400mm", parts

def a08():
    # Umpire launch: open motor launch, hull white, blue trim, dark engine
    parts=[]
    hull=(cq.Workplane("XY").box(5200,1800,900).edges("|Z").fillet(400)
          .edges(">Z").fillet(120).translate((0,0,450)))
    # carve open cockpit
    hull=hull.cut(cq.Workplane("XY").box(3800,1200,600).translate((0,0,750)))
    parts.append((hull, HULL_WHITE))
    trim=cq.Workplane("XY").box(5200,1800,120).edges("|Z").fillet(400).translate((0,0,830))
    trim=trim.cut(cq.Workplane("XY").box(3820,1220,200).translate((0,0,830)))
    parts.append((trim, HULL_TRIM))
    for yo in (-350,350):
        parts.append((cq.Workplane("XY").box(900,300,120).translate((-400,yo,760)), TIMBER))
    windscreen=cq.Workplane("XZ").box(1400,60,400).translate((1100,0,1050))
    parts.append((windscreen, GLAZE))
    engine=cq.Workplane("XY").box(500,500,700).translate((-2300,0,700))
    parts.append((engine, ENGINE))
    flag=cq.Workplane("XY").circle(20).extrude(900).translate((-2500,0,850))
    parts.append((flag, "#5A5A55"))
    return "a", "5200 x 1800 x 1500mm", parts

def a09():
    # Hexagonal gazebo
    parts=[]
    plinth=cq.Workplane("XY").polygon(6,4400).extrude(300)
    parts.append((plinth, GAZ_PLINTH))
    posts=None
    for i in range(6):
        ang=math.radians(i*60)
        x=1900*math.cos(ang); y=1900*math.sin(ang)
        p=cq.Workplane("XY").circle(90).extrude(2600).translate((x,y,300))
        posts=p if posts is None else posts.union(p)
    parts.append((posts, GAZ_POST))
    # balustrade
    bal=None
    for i in range(6):
        a1=math.radians(i*60); a2=math.radians((i+1)*60)
        x1,y1=1900*math.cos(a1),1900*math.sin(a1)
        x2,y2=1900*math.cos(a2),1900*math.sin(a2)
        mx,my=(x1+x2)/2,(y1+y2)/2
        ang=math.degrees(math.atan2(y2-y1,x2-x1))
        seg=cq.Workplane("XY").box(1700,80,700).translate((mx,my,650)).rotate((mx,my,0),(mx,my,1),ang)
        bal=seg if bal is None else bal.union(seg)
    parts.append((bal, GAZ_POST))
    # shingle roof cone
    roof=cq.Workplane("XY").polygon(6,4600).workplane(offset=1400).polygon(6,200).loft(ruled=True).translate((0,0,2900))
    parts.append((roof, GAZ_ROOF))
    return "a", "dia 4200 x 3600mm", parts

def a10():
    parts=[]
    ramp=(cq.Workplane("XZ").polyline([(0,0),(4000,0),(4000,-1000),(0,0)]).close()
          .extrude(4000).translate((-2000,0,1000)))
    parts.append((ramp, CONCRETE))
    kerbs=None
    for xo in (-1950,1950):
        k=cq.Workplane("XZ").polyline([(0,0),(4000,0),(4000,-1000),(0,0)]).close().extrude(100).translate((xo,0,1000))
        kerbs=k if kerbs is None else kerbs.union(k)
    parts.append((kerbs, "#9A968C"))
    algband=cq.Workplane("XY").box(4000,900,120).translate((0,1600,120))
    parts.append((algband, ALGAE))
    return "a", "4000 x 12000 x 1000mm", parts

def a11():
    parts=[]
    posts=None
    for xo in (-1200,1200):
        p=cq.Workplane("XY").circle(28).extrude(1100).translate((xo,0,0))
        posts=p if posts is None else posts.union(p)
    top=cq.Workplane("XZ").circle(22).extrude(2400).translate((-1200,0,1100))
    mid=cq.Workplane("XZ").circle(18).extrude(2400).translate((-1200,0,600))
    parts.append((posts.union(top).union(mid), RAIL_DARK))
    return "a", "2400 x 60 x 1100mm", parts

def a12():
    parts=[]
    pole=cq.Workplane("XY").circle(60).workplane(offset=8000).circle(20).loft()
    truck=cq.Workplane("XY").sphere(45).translate((0,0,8000))
    parts.append((pole.union(truck), WHITE))
    pennant=(cq.Workplane("XZ").moveTo(0,7900).lineTo(900,7650).lineTo(0,7400).close()
             .extrude(8).translate((0,60,0)))
    parts.append((pennant, FLAG_RED))
    return "a", "dia 120 x 8000mm", parts


# ============================================================
# TIER B - water-edge structures (b01, b02, b03)
# ============================================================
def b01():
    parts=[]
    W,D,H=30000,14000,5000
    ground=cq.Workplane("XY").box(W,D,H).translate((0,0,H/2))
    bays=None
    for i in range(6):
        x=-12000+i*4800
        bay=cq.Workplane("XY").box(3000,2400,4000).translate((x,D/2-200,2000))
        ground=ground.cut(bay)
        b=cq.Workplane("XY").box(2900,300,3900).translate((x,D/2-1500,1950))
        bays=b if bays is None else bays.union(b)
    parts.append((ground, CLAP_NE))
    parts.append((bays, BAY_DK))
    upper=(cq.Workplane("XY").box(W,D,3500).cut(cq.Workplane("XY").box(W-600,D-600,3500)).translate((0,0,6750)))
    parts.append((upper, CLAP_NE))
    balcony=cq.Workplane("XY").box(W,1600,150).translate((0,D/2+600,5100))
    rail=cq.Workplane("XY").box(W,100,900).translate((0,D/2+1350,5650))
    parts.append((balcony.union(rail), BALC))
    roof=(cq.Workplane("XZ").moveTo(-W/2,8500).lineTo(0,11000).lineTo(W/2,8500).close()
          .extrude(D).translate((0,D/2,0)))
    parts.append((roof, ROOF_NE))
    cup=cq.Workplane("XY").box(1400,1400,1100).translate((0,0,9700))
    cuproof=cq.Workplane("XY").polygon(4,1500).workplane(offset=900).polygon(4,120).loft().translate((0,0,10250))
    parts.append((cup, CLAP_NE))
    parts.append((cuproof, ROOF_NE))
    return "b", "30000 x 14000 x 11000mm", parts

def b02():
    parts=[]
    W,D=22000,12000
    # brick ground floor with arched bays
    ground=cq.Workplane("XY").box(W,D,5000).translate((0,0,2500))
    for i in range(4):
        x=-8000+i*5300
        arch=(cq.Workplane("XZ").moveTo(x-1400,0).lineTo(x-1400,2600).threePointArc((x,3400),(x+1400,2600)).lineTo(x+1400,0).close()
              .extrude(-3000).translate((0,D/2+1500,0)))
        ground=ground.cut(arch)
    parts.append((ground, BRICK_UK))
    # jettied timber upper storey (slightly oversailing)
    upper=cq.Workplane("XY").box(W+400,D+300,3200).translate((0,0,6600))
    parts.append((upper, RENDER_UK))
    # timber framing bands
    frame=None
    for xo in range(-9000,9001,3000):
        f=cq.Workplane("XY").box(150,D+320,3200).translate((xo,0,6600))
        frame=f if frame is None else frame.union(f)
    parts.append((frame, TIMBER_UK))
    # name board over centre
    parts.append((cq.Workplane("XY").box(4000,120,700).translate((0,D/2+250,5300)), TIMBER_UK))
    # slate gable roof
    roof=(cq.Workplane("XZ").moveTo(-W/2-200,8200).lineTo(0,10000).lineTo(W/2+200,8200).close()
          .extrude(D+300).translate((0,(D+300)/2,0)))
    parts.append((roof, SLATE_UK))
    return "b", "22000 x 12000 x 10000mm", parts

def b03():
    parts=[]
    W,D,H=24000,12000,8000
    block=cq.Workplane("XY").box(W,D,H*0.5).translate((0,0,H*0.25))
    parts.append((block, BLOCK_MOD))
    # full-width glazing upper, water side
    upper=cq.Workplane("XY").box(W,D,H*0.5).translate((0,0,H*0.75))
    glazing=cq.Workplane("XY").box(W-1200,300,H*0.4).translate((0,D/2-100,H*0.75))
    upper=upper.cut(cq.Workplane("XY").box(W-1200,400,H*0.42).translate((0,D/2-50,H*0.75)))
    parts.append((upper, BLOCK_MOD))
    parts.append((glazing, GLAZE_MOD))
    # cantilevered balcony
    balc=cq.Workplane("XY").box(W,2500,200).translate((0,D/2+1000,H*0.5))
    parts.append((balc, FASCIA_MOD))
    parts.append((cq.Workplane("XY").box(W,100,900).translate((0,D/2+2150,H*0.5+550)), FASCIA_MOD))
    # flat fascia roof
    parts.append((cq.Workplane("XY").box(W+400,D+400,250).translate((0,0,H+50)), FASCIA_MOD))
    return "b", "24000 x 12000 x 8000mm", parts


# ============================================================
# TIER C - crossings (c01 masonry arch, c02 concrete beam)
# ============================================================
def c01():
    parts=[]
    L=60000; D=9000; deckZ=9000
    # three semicircular arches on piers
    body=cq.Workplane("XY").box(L,D,10000).translate((0,0,5000))
    for cx in (-20000,0,20000):
        arch=(cq.Workplane("XZ").moveTo(cx-7000,0).lineTo(cx-7000,4000).threePointArc((cx,11000),(cx+7000,4000)).lineTo(cx+7000,0).close()
              .extrude(D+200).translate((0,(D+200)/2,0)))
        body=body.cut(arch)
    parts.append((body, STONE_ARCH))
    # voussoir ring accents
    rings=None
    for cx in (-20000,0,20000):
        ring=(cq.Workplane("XZ").moveTo(cx-7300,3800).threePointArc((cx,11300),(cx+7300,3800))
              .threePointArc((cx,10700),(cx-6700,3800)).close().extrude(D+260).translate((0,(D+260)/2,0)))
        rings=ring if rings is None else rings.union(ring)
    parts.append((rings, VOUSS))
    # parapet
    parts.append((cq.Workplane("XY").box(L,D,1200).cut(cq.Workplane("XY").box(L,D-1600,1200)).translate((0,0,10600)), PARAPET))
    return "c", "60000 x 9000 x 12000mm", parts

def c02():
    parts=[]
    deck=cq.Workplane("XY").box(80000,14000,1500).translate((0,0,9250))
    parts.append((deck, BR_CONC))
    for xo in (-20000,20000):
        parts.append((cq.Workplane("XY").box(2200,14000,8500).edges("|Z").fillet(300).translate((xo,0,4250)), BR_CONC))
    for yo in (-6800,6800):
        parts.append((cq.Workplane("XY").box(80000,200,1100).translate((0,yo,10550)), BR_RAIL))
    railposts=None
    for xo in range(-38000,38001,4000):
        rp=cq.Workplane("XY").box(200,13600,250).translate((xo,0,10000))
        railposts=rp if railposts is None else railposts.union(rp)
    return "c", "80000 x 14000 x 10000mm", parts


# ============================================================
# TIER F - generic biome kit (bank edges + scatter)
# ============================================================
def f01():
    # earth-cut bank, tiles at 8m
    parts=[]
    bank=(cq.Workplane("XZ").polyline([(0,0),(8000,0),(8000,2500),(6000,2500),(3000,800),(0,800),(0,0)]).close()
          .extrude(3000)).translate((-4000,0,0)).rotate((0,0,0),(0,0,1),0)
    # orient so face towards +Y; build as profile in XZ extruded along Y
    bank=(cq.Workplane("YZ").polyline([(0,0),(0,2500),(1200,2500),(2200,900),(3000,400),(3000,0),(0,0)]).close()
          .extrude(8000).translate((-4000,-1500,0)))
    parts.append((bank, SOIL))
    lip=cq.Workplane("XY").box(8000,1400,180).translate((0,-800,2500))
    parts.append((lip, GRASSLIP))
    roots=None
    for xo in range(-3500,3501,900):
        rt=cq.Workplane("XY").box(60,500,120).translate((xo,-100,2350))
        roots=rt if roots is None else roots.union(rt)
    parts.append((roots, ROOT))
    return "f", "8000 x 3000 x 2500mm (tiles)", parts

def f02():
    # shingle shelf
    parts=[]
    shelf=(cq.Workplane("YZ").polyline([(0,0),(0,300),(6000,1000),(6000,0),(0,0)]).close()
           .extrude(8000).translate((-4000,-3000,0)))
    parts.append((shelf, SHINGLE))
    wet=cq.Workplane("XY").box(8000,1500,120).translate((0,-2400,240))
    parts.append((wet, WETBAND))
    return "f", "8000 x 6000 x 1000mm (tiles)", parts

def f03():
    # reed margin
    parts=[]
    silt=(cq.Workplane("YZ").polyline([(0,0),(0,400),(5000,1500),(5000,0),(0,0)]).close()
          .extrude(8000).translate((-4000,-2500,0)))
    parts.append((silt, SILT))
    reeds=None
    import random; random.seed(3)
    for i in range(60):
        x=random.uniform(-3800,3800); y=random.uniform(-2400,-200)
        h=random.uniform(1200,1800)
        r=cq.Workplane("XY").rect(20,20).extrude(h).translate((x,y,300))
        reeds=r if reeds is None else reeds.union(r)
    parts.append((reeds, REED))
    return "f", "8000 x 5000 x 1500mm (tiles)", parts

def f04():
    # masonry canal wall
    parts=[]
    wall=cq.Workplane("XY").box(8000,800,2500).translate((0,0,1250))
    parts.append((wall, STONE_WALL))
    parts.append((cq.Workplane("XY").box(8000,1000,250).translate((0,0,2500+125)), COPING))
    parts.append((cq.Workplane("XY").box(8000,820,250).translate((0,0,300)), ALGAE2))
    # weep holes
    weeps=None
    for xo in range(-3000,3001,1000):
        w=cq.Workplane("XZ").circle(60).extrude(-820).translate((xo,410,700))
        weeps=w if weeps is None else weeps.union(w)
    parts.append((weeps, BLACK))
    return "f", "8000 x 800 x 2500mm (tiles)", parts

def f18():
    parts=[]
    import random; random.seed(1)
    blades=None; tips=None
    for i in range(9):
        ang=i*40+random.uniform(-8,8); r=60+(i%3)*70
        x=r*math.cos(math.radians(ang)); y=r*math.sin(math.radians(ang))
        h=380+(i%4)*60
        lean=random.uniform(-40,40)
        b=cq.Workplane("XY").rect(16,7).extrude(h).translate((x,y,0)).rotate((x,y,0),(1,0,0),lean/5)
        blades=b if blades is None else blades.union(b)
    parts.append((blades, GRASS))
    return "f", "500 x 500 x 600mm", parts

def f20():
    parts=[]
    import random; random.seed(2)
    stems=None
    for i in range(12):
        x=random.uniform(-400,400); y=random.uniform(-400,400)
        h=random.uniform(1900,2500)
        s=cq.Workplane("XY").rect(22,22).extrude(h).translate((x,y,0))
        stems=s if stems is None else stems.union(s)
    parts.append((stems, REED))
    heads=None
    random.seed(2)
    for i in range(12):
        x=random.uniform(-400,400); y=random.uniform(-400,400)
        h=random.uniform(1900,2500)
        hd=cq.Workplane("XY").rect(40,40).workplane(offset=350).rect(8,8).loft().translate((x,y,h))
        heads=hd if heads is None else heads.union(hd)
    parts.append((heads, REED_HEAD))
    return "f", "1200 x 1200 x 2500mm", parts

def f21():
    parts=[]
    b1=cq.Workplane("XY").box(800,600,500).edges().fillet(90).translate((-300,-200,250-40))
    b2=cq.Workplane("XY").box(600,500,400).edges().fillet(70).translate((400,100,200-30))
    b3=cq.Workplane("XY").box(400,350,300).edges().fillet(55).translate((0,400,150-20))
    parts.append((b1.union(b2).union(b3), ROCK))
    moss=cq.Workplane("XY").box(760,120,60).translate((-300,-260,470))
    parts.append((moss, MOSS))
    return "f", "1800 x 1400 x 900mm", parts

def f25():
    # bramble scrub mound
    parts=[]
    import random; random.seed(5)
    mound=cq.Workplane("XY").sphere(1000)
    from OCP.gp import gp_GTrsf
    from OCP.BRepBuilderAPI import BRepBuilderAPI_GTransform
    gt=gp_GTrsf(); gt.SetValue(3,3,0.7); gt.SetValue(1,1,1.0)
    m=cq.Shape(BRepBuilderAPI_GTransform(mound.val().wrapped,gt,True).Shape()).translate((0,0,300))
    parts.append((m, BRAMBLE))
    stems=None
    for i in range(10):
        ang=random.uniform(0,360); r=random.uniform(200,900)
        x=r*math.cos(math.radians(ang)); y=r*math.sin(math.radians(ang))
        s=cq.Workplane("XY").rect(15,15).extrude(random.uniform(600,1300)).translate((x,y,0)).rotate((x,y,0),(1,0,0),random.uniform(-25,25))
        stems=s if stems is None else stems.union(s)
    parts.append((stems, BR_STEM))
    return "f", "2000 x 2000 x 1400mm", parts

def f33():
    parts=[]
    posts=None
    for xo in (-1500,1500):
        p=cq.Workplane("XY").box(80,80,1200).translate((xo,0,600))
        posts=p if posts is None else posts.union(p)
    rails=None
    for z in (300,600,1000):
        rl=cq.Workplane("XY").box(3000,60,40).translate((0,0,z))
        rails=rl if rails is None else rails.union(rl)
    parts.append((posts.union(rails), TIMBER))
    return "f", "3000 x 100 x 1200mm (tiles)", parts

def f37():
    parts=[]
    ends=None
    for xo in (-800,800):
        e=cq.Workplane("XY").box(50,500,400).translate((xo,0,200))
        for yo in (-200,200):
            leg=cq.Workplane("XY").box(50,50,400).translate((xo,yo,200))
            e=e.union(leg)
        ends=e if ends is None else ends.union(e)
    arms=None
    for xo in (-800,800):
        a=cq.Workplane("XY").box(50,500,40).translate((xo,0,840))
        arms=a if arms is None else arms.union(a)
    parts.append((ends.union(arms), BENCH_END))
    slats=None
    for i in range(5):
        s=cq.Workplane("XY").box(1600,60,25).translate((0,-200+i*100,430))
        slats=s if slats is None else slats.union(s)
    for i in range(4):
        s=cq.Workplane("XY").box(1600,25,60).translate((0,-250,520+i*100))
        slats=slats.union(s)
    parts.append((slats, BENCH_SLAT))
    return "f", "1800 x 600 x 900mm", parts


MODELS = {
    "a01-buoy-lane-sphere": a01, "a02-buoy-turn-cylinder": a02,
    "a03-pontoon-floating-dock": a03, "a04-launch-dock-fixed": a04,
    "a05-stakeboat-platform": a05, "a06-finish-tower": a06,
    "a07-distance-marker-post": a07, "a08-umpire-launch": a08,
    "a09-gazebo-hexagonal": a09, "a10-slipway-ramp": a10,
    "a11-bank-railing": a11, "a12-regatta-flagpole": a12,
    "b01-boathouse-new-england": b01, "b02-boathouse-uk-victorian": b02,
    "b03-clubhouse-modern": b03,
    "c01-bridge-arch-masonry": c01, "c02-bridge-road-concrete": c02,
    "f01-bank-earth-cut": f01, "f02-bank-shingle-shelf": f02,
    "f03-bank-reed-margin": f03, "f04-bank-masonry-wall": f04,
    "f18-grass-tuft-clump": f18, "f20-reed-stand": f20,
    "f21-boulder-cluster": f21, "f25-bramble-scrub": f25,
    "f33-post-rail-fence": f33, "f37-park-bench": f37,
}

if __name__ == "__main__":
    ok=fail=0
    for name, fn in MODELS.items():
        if ONLY and name not in ONLY:
            continue
        try:
            tier, dims, parts = fn()
        except Exception as e:
            print(f"\n{name}\n  BUILD FN FAILED: {e}"); traceback.print_exc(); fail+=1; continue
        if build(name, tier, dims, parts):
            ok+=1
        else:
            fail+=1
    print(f"\n{'='*64}\nDone: {ok} ok, {fail} failed\n{OUTPUT_DIR}")
