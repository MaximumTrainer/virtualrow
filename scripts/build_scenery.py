"""
Colour-aware batch builder for virtualrow scenery assets (issue #216).
Each model is a list of (cadquery object, hex colour) parts.
Exports coloured GLB + STEP, renders a coloured multi-view PNG.
All dims in mm; Z=0 at waterline contact; +Y faces water; centred on X/Y.
"""
import cadquery as cq
import sys, os, math, traceback, tempfile, random
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


# --- geometry helpers (Tier D/E) -----------------------------------------
def ellipsoid(rx, ry, rz, center=(0, 0, 0)):
    from OCP.gp import gp_GTrsf
    from OCP.BRepBuilderAPI import BRepBuilderAPI_GTransform
    m = max(rx, ry, rz)
    s = cq.Workplane("XY").sphere(m)
    gt = gp_GTrsf()
    gt.SetValue(1, 1, rx / m); gt.SetValue(2, 2, ry / m); gt.SetValue(3, 3, rz / m)
    sh = cq.Shape(BRepBuilderAPI_GTransform(s.val().wrapped, gt, True).Shape())
    return sh.translate(center)

def cone(rbase, rtop, h, center=(0, 0, 0)):
    return cq.Solid.makeCone(rbase, rtop, h).translate(center)

def cyl(r, h, center=(0, 0, 0)):
    return cq.Solid.makeCylinder(r, h).translate(center)

def box(w, d, h, center=(0, 0, 0)):
    return cq.Workplane("XY").box(w, d, h).val().translate(center)

def gable(w, d, wall_h, ridge_h, cx=0, cy=0, cz=0):
    prof = (cq.Workplane("XZ").moveTo(-w/2, wall_h).lineTo(0, ridge_h)
            .lineTo(w/2, wall_h).close().extrude(d))
    return prof.val().translate((cx, cy + d/2, cz))

def pyramid(w, d, base_z, apex_h, cx=0, cy=0):
    return (cq.Workplane("XY").rect(w, d).workplane(offset=apex_h).rect(4, 4)
            .loft().val().translate((cx, cy, base_z)))


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

# ============================================================
# TIER D - regional architecture kits
# Colours from issue #216 palette per region.
# ============================================================
BARK_PLANE="#9A8E70"; PLANE_FOL="#4E7A3E"
WIL_BARK="#6E5F4A"; WIL_FOL="#8AA85C"
POP_BARK="#8A8578"; POP_FOL="#5E8A46"
OAK_BARK="#5A4A3A"; OAK_FOL="#3E6B32"
MAP_BARK="#6E6258"; MAP_FOL="#4A7A3A"; MAP_AUT="#B83A26"
BIR_BARK="#EDEAE0"; BIR_FOL="#7AA84E"
EWP_BARK="#4A423A"; EWP_NDL="#3A5E4A"
SCP_BARK="#B06A3E"; SCP_NDL="#3E5A48"
ALD_BARK="#4E453C"; ALD_FOL="#41663A"
CYP="#2E4A38"
POLL_TR="#6E5F4A"; POLL_WH="#8A9A56"
LEAF1="#B8722E"; LEAF2="#8B4A20"

# D-US
CLAP_US="#E4E0D4"; ROOF_US="#4A4038"; TRIM_US="#F5F3ED"; CHIM="#8C4A38"
MILL_BRK="#8C4A38"; MILL_SILL="#C8C0B0"; MILL_ROOF="#3E3A34"
LIME="#D8D2C2"; DOME_CU="#6E9284"; COL_US="#E8E4D8"
CTOWER_ST="#A89E8C"; CTOWER_RF="#3E4A52"; CLOCK="#F2EFE4"
WT_TANK="#C8CCC8"; WT_LEG="#5A5F66"
GANTRY="#8A9096"; SIGN_G="#1F6B3A"
# D-GB
TER_BRK="#8B4A3A"; TER_SLATE="#4A4E54"; TER_STUC="#E8E0D0"
RAG="#9A968A"; CH_RF="#4A4E54"; LOUVRE="#3A3228"
PUB_REN="#F0EAD8"; PUB_TRIM="#1E3A2E"; PUB_SIGN="#8B2E20"
COT_RUB="#8E8778"; COT_RF="#3E4248"; COT_DOOR="#2E4A3A"
BARN_ST="#8E8778"; BARN_RF="#6E6A62"
CANVAS="#F5F3ED"; MARQ_POLE="#8B7355"
# D-NL
NL_BRK="#7A4034"; NL_GABLE="#F2F2F0"; NL_SHUT="#1E3A2E"
THATCH="#9A7E52"; MILL_BASE="#6E4A38"; SAIL="#E8E4DA"
STOLP_BRK="#7A4034"; STOLP_BOARD="#2E4A3A"; STOLP_RF="#5A5248"
LOCK_MAS="#A29A8C"; LOCK_GATE="#2E4A3A"; LOCK_BEAM="#F2F2F0"
TURBINE="#F2F2F0"
NL_PILE="#6E5A42"; NL_REED="#A89A6E"
# D-CE
CE_REN="#E8DCC0"; CE_DOME="#5E6E68"; CE_TRIM="#F2ECDC"
PANEL="#D8D4C8"; PBALC="#A8B0AE"; PJOINT="#B0ACA0"
VILLA_ST="#E4D8C0"; VILLA_RF="#6E5248"; VILLA_VER="#F2ECDC"
WEIR_CONC="#B0ACA4"; WEIR_HOUSE="#8B7355"; WEIR_GEAR="#3A4048"
# D-IT
PAL_OCH="#D8A860"; PAL_SHUT="#3E5A3E"; PAL_CORN="#E8DCC0"
CAST_BRK="#9A5A44"; CAST_RF="#3E4A52"; CAST_ST="#E0D8C4"
EMB_ST="#C0B49C"; EMB_BAL="#D8D0BC"


# --- D-US ---
def d_us_01():  # clapboard house 12x9x9
    p=[]
    p.append((box(12000,9000,5500,(0,0,2750)), CLAP_US))
    p.append((gable(12000,9000,5500,9000,0,0,0), ROOF_US))
    p.append((box(1200,300,2600,(0,4500,1300)), TRIM_US))     # door surround
    p.append((box(900,200,2200,(0,4550,1100)), COT_DOOR))     # door
    p.append((cyl(400,2200,(3800,0,8000)), CHIM))             # chimney
    return "d","12000 x 9000 x 9000mm (D-US)",p

def d_us_02():  # brick mill 70x20x22
    p=[]
    p.append((box(70000,20000,18000,(0,0,9000)), MILL_BRK))
    # low-pitch roof
    p.append((gable(70000,20000,18000,22000,0,0,0), MILL_ROOF))
    # sill bands (windows suggested)
    for z in (5000,9000,13000):
        p.append((box(70000,60,600,(0,10020,z)), MILL_SILL))
    # stair tower
    p.append((box(6000,6000,24000,(-30000,4000,12000)), MILL_BRK))
    # tall square chimney
    p.append((box(2600,2600,10000,(30000,-6000,23000)), MILL_BRK))
    return "d","70000 x 20000 x 22000mm (D-US)",p

def d_us_03():  # collegiate dome 45x30x28
    p=[]
    p.append((box(45000,30000,16000,(0,0,8000)), LIME))
    # portico: 6 Ionic columns + pediment (front +Y)
    for i in range(6):
        x=-11000+i*4400
        p.append((cyl(700,11000,(x,14500,0)), COL_US))
    p.append((box(16000,3000,2000,(0,15000,12000)), COL_US))      # entablature
    p.append((gable(16000,3000,12000,16000,0,15000,0), LIME))     # pediment
    # drum + copper dome
    p.append((cyl(6000,4000,(0,0,16000)), LIME))
    p.append((ellipsoid(6000,6000,5000,(0,0,20000)), DOME_CU))
    p.append((cyl(400,2000,(0,0,25000)), DOME_CU))               # finial
    return "d","45000 x 30000 x 28000mm (D-US)",p

def d_us_04():  # collegiate gothic tower 12x12x40
    p=[]
    p.append((box(12000,12000,36000,(0,0,18000)), CTOWER_ST))
    # corner pinnacles
    for xo in (-5500,5500):
        for yo in (-5500,5500):
            p.append((cone(900,80,4000,(xo,yo,36000)), CTOWER_RF))
    # louvred belfry band
    p.append((box(12200,12200,4000,(0,0,30000)), LOUVRE))
    # clock faces two sides
    for yo,cy in ((6100,0),(-6100,0)):
        p.append((box(2600,60,2600,(0,yo,26000)), CLOCK))
    return "d","12000 x 12000 x 40000mm (D-US)",p

def d_us_05():  # elevated water tower dia9 x26
    p=[]
    p.append((cyl(4500,7000,(0,0,17000)), WT_TANK))          # tank
    p.append((cone(4700,300,3500,(0,0,24000)), WT_TANK))     # conical roof
    for i in range(6):
        a=math.radians(i*60); x=3600*math.cos(a); y=3600*math.sin(a)
        p.append((box(300,300,17000,(x,y,8500)), WT_LEG))    # legs
    p.append((cyl(4900,300,(0,0,17000)), WT_LEG))            # walkway ring base
    return "d","dia 9000 x 26000mm (D-US)",p

def d_us_06():  # highway sign gantry 20x2x8
    p=[]
    for xo in (-9000,9000):
        p.append((box(500,500,8000,(xo,0,4000)), GANTRY))
    p.append((box(20000,600,1200,(0,0,7500)), GANTRY))       # truss beam
    p.append((box(9000,150,3000,(0,-400,6200)), SIGN_G))     # green sign
    return "d","20000 x 2000 x 8000mm (D-US)",p

# --- D-GB ---
def d_gb_01():  # brick terrace of 4  24x8x10
    p=[]
    p.append((box(24000,8000,7000,(0,0,3500)), TER_BRK))
    p.append((gable(24000,8000,7000,10000,0,0,0), TER_SLATE))
    for i in range(4):
        x=-9000+i*6000
        p.append((box(2400,1200,2600,(x,4600,2200)), TER_STUC))   # bay window
        p.append((box(900,900,3000,(x,0,10500)), CHIM))           # party chimney
    p.append((box(24000,200,900,(0,4700,700)), TER_STUC))         # front wall
    return "d","24000 x 8000 x 10000mm (D-GB)",p

def d_gb_02():  # parish church square tower 32x14x24
    p=[]
    p.append((box(20000,14000,10000,(-4000,0,5000)), RAG))        # nave
    p.append((gable(20000,14000,10000,14000,-4000,0,0), CH_RF))
    p.append((box(9000,9000,22000,(-13000,0,11000)), RAG))        # west tower
    for xo in (-16500,-9500):
        for yo in (-4000,4000):
            p.append((cone(700,60,2600,(xo,yo,22000)), CH_RF))    # pinnacles
    p.append((box(9200,9200,3000,(-13000,0,18000)), LOUVRE))      # belfry louvres
    p.append((box(2200,60,2200,(-13000,4700,15000)), CLOCK))      # clock
    return "d","32000 x 14000 x 24000mm (D-GB)",p

def d_gb_03():  # riverside pub 16x11x9
    p=[]
    p.append((box(16000,11000,6500,(0,0,3250)), PUB_REN))
    p.append((gable(16000,11000,6500,9000,0,0,0), TER_SLATE))
    p.append((box(3000,400,1400,(0,5500,4500)), PUB_TRIM))        # fascia band
    p.append((box(1600,120,1000,(6000,5600,3500)), PUB_SIGN))     # hanging sign
    p.append((cyl(80,1200,(6800,5600,3900)), PUB_TRIM))           # sign bracket
    # terrace with benches + parasols
    p.append((box(9000,4000,120,(0,8000,60)), MARQ_POLE))
    for xo in (-2500,2500):
        p.append((box(1600,400,700,(xo,8000,400)), MARQ_POLE))    # benches
        p.append((cone(1400,80,900,(xo,8000,2200)), CANVAS))      # parasols
        p.append((cyl(50,1800,(xo,8000,900)), WT_LEG))
    return "d","16000 x 11000 x 9000mm (D-GB)",p

def d_gb_04():  # stone cottage 10x7x7
    p=[]
    p.append((box(10000,7000,3500,(0,0,1750)), COT_RUB))
    p.append((gable(10000,7000,3500,7000,0,0,0), COT_RF))
    p.append((box(1600,2000,1600,(1500,0,4200)), COT_RF))         # dormer
    p.append((box(900,200,1900,(0,3550,950)), COT_DOOR))          # door
    p.append((box(800,800,1600,(-4000,0,7000)), COT_RUB))         # gable chimney
    return "d","10000 x 7000 x 7000mm (D-GB)",p

def d_gb_05():  # stone barn 18x9x8
    p=[]
    body=cq.Workplane("XY").box(18000,9000,5000).translate((0,0,2500))
    body=body.cut(cq.Workplane("XY").box(4000,3000,4200).translate((0,4600,2100)))  # cart opening
    p.append((body, BARN_ST))
    p.append((gable(18000,9000,5000,8000,0,0,0), BARN_RF))
    p.append((box(6000,3000,3200,(11000,0,1600)), BARN_ST))       # lean-to
    p.append((gable(6000,3000,3200,4200,11000,0,0), BARN_RF))
    return "d","18000 x 9000 x 8000mm (D-GB)",p

def d_gb_06():  # regatta marquee 20x10x6
    p=[]
    for xo in (-9000,-3000,3000,9000):
        for yo in (-4500,4500):
            p.append((cyl(120,4000,(xo,yo,2000)), MARQ_POLE))
    # peaked canvas roof (two gable slopes)
    p.append((gable(20000,10000,4000,6000,0,0,0), CANVAS))
    p.append((box(20000,10000,120,(0,0,4000)), CANVAS))          # eaves band
    # scalloped valance
    p.append((box(20000,200,600,(0,5000,3700)), CANVAS))
    return "d","20000 x 10000 x 6000mm (D-GB)",p

# --- D-NL ---
def d_nl_01():  # gabled canal house 6x12x16
    p=[]
    p.append((box(6000,12000,15000,(0,0,7500)), NL_BRK))
    # stepped gable (front +Y)
    for i,(w,z) in enumerate([(6000,15200),(4400,16000),(2800,16800),(1400,17600)]):
        p.append((box(w,600,900,(0,5700,z-450)), NL_GABLE))
    p.append((box(400,1400,400,(0,6200,17400)), NL_BRK))         # hoist beam
    # shuttered windows
    for z in (4000,8000,12000):
        for xo in (-1400,1400):
            p.append((box(700,80,1500,(xo,5980,z)), NL_SHUT))
    p.append((box(2400,1200,600,(0,6200,300)), NL_GABLE))        # stoop
    return "d","6000 x 12000 x 16000mm (D-NL)",p

def d_nl_02():  # polder windmill dia12 x22, sails dia26
    p=[]
    p.append((cone(6000,5000,4000,(0,0,0)), MILL_BASE))         # brick base
    # octagonal tapered thatched body
    body=(cq.Workplane("XY").polygon(8,10000).workplane(offset=15000).polygon(8,6000).loft())
    p.append((body.val().translate((0,0,4000)), THATCH))
    p.append((cone(3200,300,2500,(0,0,19000)), MILL_BASE))      # cap
    # 4 lattice sails (cross) in XZ plane facing +Y, at hub z=17000
    hub=17000
    for ang in (0,90,180,270):
        arm=box(1400,300,13000,(0,-800,0))
        arm=arm.rotate((0,0,0),(0,1,0),ang).translate((0,-900,hub))
        p.append((arm, SAIL))
    p.append((box(400,3000,400,(0,-900,hub)), MILL_BASE))       # tailpole hint
    return "d","dia 12000 x 22000mm, sails dia 26000 (D-NL)",p

def d_nl_03():  # stolpboerderij 24x24x14
    p=[]
    p.append((box(24000,24000,5000,(0,0,2500)), STOLP_BRK))
    p.append((box(24000,24000,3000,(0,0,6000)), STOLP_BOARD))   # green boarding band
    p.append((pyramid(25000,25000,7500,7000,0,0), STOLP_RF))    # huge pyramidal roof
    for xo in (-8000,-2700,2700,8000):
        p.append((box(2000,200,3500,(xo,12000,1750)), STOLP_RF))  # stable doors
    return "d","24000 x 24000 x 14000mm (D-NL)",p

def d_nl_04():  # canal lock (sluis) 30x12x6
    p=[]
    for yo in (-4500,4500):
        p.append((box(30000,3000,6000,(0,yo,3000)), LOCK_MAS))  # chambers
    for xo in (-13000,13000):
        p.append((box(1000,6000,5000,(xo,0,2500)), LOCK_GATE))  # mitre gates
        p.append((box(6000,300,300,(xo-2500,0,5200)), LOCK_BEAM))  # balance beams
    p.append((box(2000,12000,400,(0,0,6000)), LOCK_BEAM))       # walkway
    for xo in (-13000,13000):
        for yo in (-5500,5500):
            p.append((cyl(300,700,(xo,yo,6000)), LOCK_GATE))    # bollards
    return "d","30000 x 12000 x 6000mm (D-NL)",p

def d_nl_05():  # wind turbine rotor dia90 hub85
    p=[]
    p.append((cone(2500,1200,85000,(0,0,0)), TURBINE))          # tapered tower
    p.append((box(4000,2000,2200,(0,-1500,85000)), TURBINE))    # nacelle
    for ang in (90,210,330):
        blade=box(2200,400,45000,(0,0,22000))
        blade=blade.rotate((0,0,0),(0,1,0),ang).translate((0,-2600,85000))
        p.append((blade, TURBINE))
    return "d","rotor dia 90000, hub 85000mm (D-NL)",p

def d_nl_06():  # reed bank edge 8x3x1.5
    p=[]
    bank=(cq.Workplane("YZ").polyline([(0,0),(0,1500),(3000,300),(3000,0),(0,0)]).close()
          .extrude(8000).translate((-4000,-1500,0)))
    p.append((bank, NL_PILE))
    for xo in range(-3600,3601,600):
        p.append((box(120,120,1600,(xo,-1400,300)), NL_PILE))   # piles
    reeds=None; random.seed(9)
    for i in range(40):
        x=random.uniform(-3800,3800); y=random.uniform(-1300,200)
        r=cq.Workplane("XY").rect(18,18).extrude(random.uniform(900,1400)).translate((x,y,600))
        reeds=r if reeds is None else reeds.union(r)
    p.append((reeds, NL_REED))
    return "d","8000 x 3000 x 1500mm (D-NL, tiles)",p

# --- D-CE ---
def d_ce_01():  # baroque onion church 28x16x30
    p=[]
    p.append((box(28000,16000,16000,(0,0,8000)), CE_REN))
    p.append((gable(28000,16000,16000,20000,0,0,0), VILLA_RF))
    p.append((box(7000,7000,22000,(-9000,0,11000)), CE_REN))    # tower
    p.append((cyl(3600,3000,(-9000,0,22000)), CE_DOME))         # onion base
    p.append((ellipsoid(4200,4200,4500,(-9000,0,25500)), CE_DOME))  # bulbous onion
    p.append((cone(1200,80,2500,(-9000,0,29000)), CE_DOME))     # lantern spike
    p.append((cyl(1200,1600,(-9000,0,29500)), CE_TRIM))         # lantern
    return "d","28000 x 16000 x 30000mm (D-CE)",p

def d_ce_02():  # panelak slab 60x14x26
    p=[]
    p.append((box(60000,14000,26000,(0,0,13000)), PANEL))
    for i in range(8):
        z=1600+i*3100
        p.append((box(60200,14200,200,(0,0,z)), PJOINT))        # floor joints
        p.append((box(60000,600,900,(0,7000,z+800)), PBALC))    # balcony band
    for xo in range(-27000,27001,6000):
        p.append((box(200,14200,26000,(xo,0,13000)), PJOINT))   # vertical joints
    return "d","60000 x 14000 x 26000mm (D-CE)",p

def d_ce_03():  # riverside villa 16x14x14
    p=[]
    p.append((box(16000,14000,9000,(0,0,4500)), VILLA_ST))
    p.append((pyramid(17000,15000,9000,4000,0,0), VILLA_RF))    # hipped roof
    p.append((box(4000,4000,13000,(-6000,-5000,6500)), VILLA_ST))  # corner tower
    p.append((cone(2900,80,4000,(-6000,-5000,13000)), VILLA_RF))   # spirelet
    p.append((box(9000,2500,3200,(0,8000,1600)), VILLA_VER))    # veranda facing water
    return "d","16000 x 14000 x 14000mm (D-CE)",p

def d_ce_04():  # hydro weir house 40x12x12
    p=[]
    p.append((box(40000,12000,4000,(0,0,2000)), WEIR_CONC))     # weir sill
    for xo in (-13000,0,13000):
        p.append((box(2000,12000,5000,(xo,0,2500)), WEIR_CONC)) # piers
    p.append((box(40000,8000,4000,(0,0,8000)), WEIR_HOUSE))     # machine house
    p.append((gable(40000,8000,4000,11000,0,0,0), WEIR_GEAR))
    p.append((box(42000,1200,1200,(0,-5000,6500)), WEIR_GEAR))  # gantry
    return "d","40000 x 12000 x 12000mm (D-CE)",p

# --- D-IT ---
def d_it_01():  # po palazzo 30x18x22
    p=[]
    body=cq.Workplane("XY").box(30000,18000,20000).translate((0,0,10000))
    # ground-floor arcade (front +Y)
    for i in range(5):
        x=-12000+i*6000
        arch=(cq.Workplane("XZ").moveTo(x-2000,0).lineTo(x-2000,3500)
              .threePointArc((x,5000),(x+2000,3500)).lineTo(x+2000,0).close()
              .extrude(-4000).translate((0,9000+2000,0)))
        body=body.cut(arch)
    p.append((body, PAL_OCH))
    for z in (8000,12000,16000):                                # shuttered windows
        for i in range(5):
            x=-12000+i*6000
            p.append((box(1600,80,2600,(x,9020,z)), PAL_SHUT))
    p.append((box(31000,19000,1200,(0,0,20600)), PAL_CORN))     # deep cornice
    p.append((pyramid(31000,19000,21200,2500,0,0), CAST_RF))    # shallow hipped roof
    return "d","30000 x 18000 x 22000mm (D-IT)",p

def d_it_02():  # castello valentino 60x45x30
    p=[]
    p.append((box(60000,45000,18000,(0,0,9000)), CAST_BRK))
    for xo in (-27000,27000):
        for yo in (-19000,19000):
            p.append((box(9000,9000,26000,(xo,yo,13000)), CAST_ST))     # corner towers
            p.append((pyramid(9500,9500,26000,7000,xo,yo), CAST_RF))    # pavilion roofs
    p.append((pyramid(60000,45000,18000,9000,0,0), CAST_RF))            # main roof
    p.append((box(50000,8000,1500,(0,24000,750)), EMB_ST))             # river terrace
    return "d","60000 x 45000 x 30000mm (D-IT)",p

def d_it_03():  # arcaded embankment 30x8x8
    p=[]
    p.append((box(30000,8000,4000,(0,0,2000)), EMB_ST))         # lower mass
    for i in range(6):
        x=-12500+i*5000
        arch=(cq.Workplane("XZ").moveTo(x-1600,0).lineTo(x-1600,2200)
              .threePointArc((x,3200),(x+1600,2200)).lineTo(x+1600,0).close()
              .extrude(-3000).translate((0,4000+1500,0)))
        # cut arcade into lower walk
    walk=cq.Workplane("XY").box(30000,8000,4000).translate((0,0,2000))
    for i in range(6):
        x=-12500+i*5000
        arch=(cq.Workplane("XZ").moveTo(x-1400,300).lineTo(x-1400,2200)
              .threePointArc((x,3000),(x+1400,2200)).lineTo(x+1400,300).close()
              .extrude(8200).translate((0,-4100,0)))
        walk=walk.cut(arch)
    p=[(walk, EMB_ST)]
    p.append((box(30000,8000,3000,(0,0,5500)), EMB_ST))         # upper promenade
    p.append((box(30000,400,900,(0,3800,7500)), EMB_BAL))       # balustrade
    for xo in range(-13000,13001,3000):                          # stairs to water
        p.append((box(2000,1500,300,(xo,4200,300)), EMB_ST))
    return "d","30000 x 8000 x 8000mm (D-IT)",p


# ============================================================
# TIER E - vegetation (stylized low-poly; flat colour)
# Trunk + crown as separate coloured parts (boolean-free).
# ============================================================
def _trunk(h, r0, r1, bark, cx=0, cy=0):
    return (cone(r0, r1, h, (cx, cy, 0)), bark)

def e01():  # london plane 22m
    p=[_trunk(9000,450,320,BARK_PLANE)]
    p.append((ellipsoid(6500,6500,5000,(0,0,15500)), PLANE_FOL))
    p.append((ellipsoid(4000,4000,3200,(2500,1500,12500)), PLANE_FOL))
    p.append((ellipsoid(4000,4000,3200,(-2500,-1200,13000)), PLANE_FOL))
    return "e","H 22000mm (London plane)",p

def e02():  # weeping willow 14m
    p=[_trunk(3500,600,450,WIL_BARK)]
    p.append((ellipsoid(6000,6000,3800,(0,0,7500)), WIL_FOL))       # broad crown
    p.append((ellipsoid(6800,6800,1600,(0,0,4200)), WIL_FOL))       # drooping skirt
    return "e","H 14000mm (weeping willow)",p

def e03():  # lombardy poplar 26m
    p=[_trunk(4000,400,250,POP_BARK)]
    p.append((ellipsoid(2400,2400,11500,(0,0,14000)), POP_FOL))     # narrow column
    return "e","H 26000mm (Lombardy poplar)",p

def e04():  # english oak 20m
    p=[_trunk(5000,800,600,OAK_BARK)]
    p.append((ellipsoid(6500,6500,4500,(0,0,13000)), OAK_FOL))
    p.append((ellipsoid(4200,4200,3200,(3500,2000,10500)), OAK_FOL))
    p.append((ellipsoid(4200,4200,3200,(-3200,-2500,11000)), OAK_FOL))
    return "e","H 20000mm (English oak)",p

def e05():  # red maple 18m
    p=[_trunk(5000,500,360,MAP_BARK)]
    p.append((ellipsoid(4200,4200,5500,(0,0,11500)), MAP_FOL))
    return "e","H 18000mm (red maple)",p

def e06():  # white birch 16m (clump of 3)
    p=[]
    for cx,cy,r in [(0,0,220),(-700,400,180),(600,-300,170)]:
        p.append(_trunk(16000,r,120,BIR_BARK,cx,cy))
        p.append((ellipsoid(2200,2200,3000,(cx,cy,12500)), BIR_FOL))
    return "e","H 16000mm (white birch)",p

def e07():  # eastern white pine 28m (tiered whorls)
    p=[_trunk(6000,600,300,EWP_BARK)]
    z=6000
    for r in (5200,4300,3400,2500,1500):
        p.append((cone(r,0,4500,(0,0,z)), EWP_NDL))
        z+=4400
    return "e","H 28000mm (eastern white pine)",p

def e08():  # scots pine 20m (bare trunk, flat crown)
    p=[_trunk(13000,500,320,SCP_BARK)]
    p.append((ellipsoid(5000,5000,2200,(0,0,15500)), SCP_NDL))
    p.append((ellipsoid(3200,3200,1600,(1500,0,17500)), SCP_NDL))
    return "e","H 20000mm (Scots pine)",p

def e09():  # alder scrub 6m (multi-stem shrub)
    p=[]; random.seed(4)
    for i in range(5):
        a=math.radians(i*72); x=400*math.cos(a); y=400*math.sin(a)
        p.append(_trunk(4000,150,90,ALD_BARK,x,y))
    p.append((ellipsoid(2600,2600,2400,(0,0,4200)), ALD_FOL))
    p.append((ellipsoid(1800,1800,1600,(1200,600,3000)), ALD_FOL))
    return "e","H 6000mm (alder scrub)",p

def e10():  # italian cypress 15m
    p=[(cone(1300,200,15000,(0,0,0)), CYP)]                         # tight dark column
    return "e","H 15000mm (Italian cypress)",p

def e11():  # reed bed clump 2.5m
    p=[]; random.seed(7); stems=None
    for i in range(16):
        x=random.uniform(-500,500); y=random.uniform(-500,500)
        r=cq.Workplane("XY").rect(20,20).extrude(random.uniform(2000,2500)).translate((x,y,0))
        stems=r if stems is None else stems.union(r)
    p.append((stems, NL_REED))
    heads=None; random.seed(7)
    for i in range(16):
        x=random.uniform(-500,500); y=random.uniform(-500,500)
        h=random.uniform(2000,2500)
        hd=cq.Workplane("XY").rect(45,45).workplane(offset=350).rect(8,8).loft().translate((x,y,h))
        heads=hd if heads is None else heads.union(hd)
    p.append((heads, REED_HEAD))
    return "e","H 2500mm (reed bed clump)",p

def e12():  # pollarded willow 5m
    p=[(cone(600,500,2500,(0,0,0)), POLL_TR)]                      # stumpy trunk
    random.seed(8)
    for i in range(14):
        a=math.radians(i*26); r=random.uniform(200,500)
        x=r*math.cos(a); y=r*math.sin(a)
        whip=box(60,60,random.uniform(1800,2500),(x,y,2500))
        whip=whip.rotate((x,y,2500),(1,0,0),random.uniform(-30,30))
        p.append((whip, POLL_WH))
    return "e","H 5000mm (pollarded willow)",p

def e13():  # mown bank grass patch (tile 8m)
    p=[(box(8000,2000,120,(0,0,60)), GRASS)]
    p.append((box(8000,120,180,(0,-1000,90)), GRASS_DRY))         # mown edge
    return "e","8000 x 2000 x 150mm (mown grass, tiles)",p

def e14():  # autumn leaf litter scatter
    p=[]; random.seed(11)
    for i in range(28):
        x=random.uniform(-1400,1400); y=random.uniform(-1400,1400)
        col=LEAF1 if i%2 else LEAF2
        leaf=box(random.uniform(120,220),random.uniform(120,220),12,(x,y,6))
        p.append((leaf, col))
    return "e","3000 x 3000mm scatter (autumn leaves)",p


MODELS.update({
    "d-us-01-clapboard-house": d_us_01, "d-us-02-brick-mill": d_us_02,
    "d-us-03-collegiate-dome": d_us_03, "d-us-04-collegiate-tower": d_us_04,
    "d-us-05-water-tower": d_us_05, "d-us-06-highway-sign-gantry": d_us_06,
    "d-gb-01-terrace-brick": d_gb_01, "d-gb-02-church-square-tower": d_gb_02,
    "d-gb-03-riverside-pub": d_gb_03, "d-gb-04-stone-cottage": d_gb_04,
    "d-gb-05-stone-barn": d_gb_05, "d-gb-06-regatta-marquee": d_gb_06,
    "d-nl-01-gabled-canal-house": d_nl_01, "d-nl-02-polder-windmill": d_nl_02,
    "d-nl-03-polder-farmhouse": d_nl_03, "d-nl-04-canal-lock": d_nl_04,
    "d-nl-05-wind-turbine": d_nl_05, "d-nl-06-reed-bank-edge": d_nl_06,
    "d-ce-01-baroque-church-onion": d_ce_01, "d-ce-02-panelak-block": d_ce_02,
    "d-ce-03-riverside-villa": d_ce_03, "d-ce-04-hydro-weir-house": d_ce_04,
    "d-it-01-po-palazzo": d_it_01, "d-it-02-castello-valentino": d_it_02,
    "d-it-03-arcaded-embankment": d_it_03,
    "e01-london-plane": e01, "e02-weeping-willow": e02,
    "e03-lombardy-poplar": e03, "e04-english-oak": e04,
    "e05-red-maple": e05, "e06-white-birch": e06,
    "e07-eastern-white-pine": e07, "e08-scots-pine": e08,
    "e09-alder-scrub": e09, "e10-italian-cypress": e10,
    "e11-reed-bed-clump": e11, "e12-pollarded-willow": e12,
    "e13-mown-bank-grass": e13, "e14-autumn-leaf-litter": e14,
})

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
