/**
 * Pixel-art ant sprites, authored in Claude Design from the reference image.
 * Source of truth: an indexed pixel grid per caste (palette + char rows, one
 * char per pixel, "." = transparent). The renderer maps each char → one filled
 * pixel, so what's designed here is exactly what ships.
 */
export type Sprite = {
  name: string;
  w: number; h: number;
  palette: Record<string, string | null>;
  pixels: string[];
};

export const SPRITES: Sprite[] = [
  {
    name: "worker",
    w: 14, h: 20,
    palette: { "O": "#bf4c31", "L": "#ec7732", "D": "#98232c", "M": "#4c1018", ".": null },
    pixels: [
      "....O.....O...",
      "....O.....O...",
      "....D.....D...",
      ".....M...M....",
      ".M....LOD....M",
      "..O..OMOMD..O.",
      "..D..OLOOD..D.",
      "...M.OOODD.M..",
      "....M.MMM.M...",
      ".M...MLODM...M",
      "..D..OLOOD..D.",
      "...MMOLOODMM..",
      ".....OOODD....",
      "....M.MMM.M...",
      "...M..LOD..M..",
      "..D..MMMMM..D.",
      "..D..OLOOD..D.",
      ".M...MMMMM...M",
      ".....OLOOD....",
      "......OOD.....",
    ],
  },
  {
    name: "forager",
    w: 14, h: 20,
    palette: { "O": "#cf5a3a", "L": "#f2843a", "D": "#98232c", "M": "#4c1018", "G": "#4f9b32", "g": "#8ad457", ".": null },
    pixels: [
      "....O.....O...",
      "....O.....O...",
      "....D.gGg.D...",
      ".....DGGGD....",
      ".M....LOL....M",
      "..O..OMLMO..O.",
      "..D..OLLLD..D.",
      "...D.OOLDD.D..",
      "....D.DDD.D...",
      ".M...DLOOD...M",
      "..D..OLLLO..D.",
      "...DMOLLODMD..",
      ".....OOLDD....",
      "....M.MMM.M...",
      "...D..LLD..D..",
      "..D..DDDMM..D.",
      "..D..OLLOM..D.",
      ".M...DDMMM...M",
      ".....OLLOM....",
      "......OMM.....",
    ],
  },
  {
    name: "soldier",
    w: 16, h: 22,
    palette: { "O": "#9e3a26", "L": "#c85a2e", "D": "#7a1c22", "M": "#38090f", ".": null },
    pixels: [
      "....O......O....",
      "....O.M..M.O....",
      "....D.D..D.D....",
      ".....MD..DM.....",
      ".M...OLOOOD...M.",
      "L...OOMOOMDD...L",
      "D...OLLOOOOD...D",
      "D...OLLOOOOD...D",
      ".MD.OLLOOODD.DM.",
      "..MM.OLOODD.MM..",
      "...MMMMMMMMMM...",
      ".....OLOOOD.....",
      ".DDMMLLOODDMMDD.",
      "D....OLOOODM...D",
      "M..MMMMMMMMMM..M",
      "..DMOLLOOOODMD..",
      ".DM.MMMMMMMM.MD.",
      ".MM.OLLOOOOD.MM.",
      "D...MMMMMMMM...D",
      "M...OOLOOODD...M",
      ".....OOLODD.....",
      "......OODD......",
    ],
  },
  {
    name: "queen",
    w: 16, h: 26,
    palette: { "O": "#d99a2e", "L": "#f3cf66", "D": "#a86a16", "M": "#5c3a0e", "W": "#f0dca6", ".": null },
    pixels: [
      ".....O....O.....",
      ".....O....O.....",
      ".....D....D.....",
      "......M..M......",
      "...M.OLOOOD.M...",
      "..D..OMLOMD..D..",
      "..D..OLLLOD..D..",
      "..O..OOLODD..O..",
      "...O..MMMM..D...",
      "....MOLLOODM....",
      "...L.OLOOOD.L...",
      "..WWWDLOOOMWWW..",
      ".MWLLWLOODWLLWM.",
      "M.WLWWLOODWWLW.M",
      "D.LW.MOOODM.WL.D",
      "D.WW.MMMMMM.WW.D",
      "M.LLMOLOOODMLL.M",
      "...MOLOOOOODM...",
      "..O.MMMMMMMM.O..",
      "..D.OLOOOOOD.D..",
      "..D.MMMMMMMM.D..",
      ".M..OLOOOOOD..M.",
      "M...MMMMMMMM...M",
      ".....OLOOOD.....",
      "......OOOD......",
      "......OOD.......",
    ],
  },
  {
    name: "egg",
    w: 9, h: 14,
    palette: { "O": "#ebe1c8", "L": "#f8f3e6", "D": "#c7b189", ".": null },
    pixels: [
      "...LLD...",
      "..LLLOD..",
      "..LLLLD..",
      ".LLLLLLD.",
      ".LLLLLOD.",
      "DOOLOOODD",
      "ODDOODDOD",
      "LODDDDOOD",
      "LLLLLLOOD",
      "DOOLOOODD",
      "ODDOODDOD",
      "LLODDLOOD",
      ".LLLLOOD.",
      "..DDDDD..",
    ],
  },
  {
    name: "egg2",
    w: 9, h: 14,
    palette: { "O": "#ebe1c8", "L": "#f8f3e6", "D": "#c7b189", "G": "#4f9b32", "g": "#8ad457", ".": null },
    pixels: [
      ".........",
      ".........",
      ".........",
      ".........",
      ".......gg",
      "GgG...GGD",
      "ODGGggDgD",
      "LODgDDgOD",
      "LLOgLOGgD",
      "DOOGOOODD",
      "ODDOODDOD",
      "LLODDLOOD",
      ".LLLLOOD.",
      "..DDDDD..",
    ],
  },
  {
    name: "forager2",
    w: 14, h: 20,
    palette: { "O": "#cf5a3a", "L": "#f2843a", "D": "#98232c", "M": "#4c1018", ".": null },
    pixels: [
      "....O.....O...",
      "....O.....O...",
      "....D.....D...",
      ".....D...D....",
      ".M....LOL....M",
      "..O..OMLMO..O.",
      "..D..OLLLD..D.",
      "...D.OOLDD.D..",
      "....D.DDD.D...",
      ".M...DLOOD...M",
      "..D..OLLLO..D.",
      "...DMOLLODMD..",
      ".....OOLDD....",
      "....M.MMM.M...",
      "...D..LLD..D..",
      "..D..DDDMM..D.",
      "..D..OLOOM..D.",
      ".M...DDMMM...M",
      ".....OLLOM....",
      "......OMM.....",
    ],
  },
  {
    name: "larder",
    w: 14, h: 24,
    palette: { "O": "#bf6a31", "L": "#e29250", "D": "#ba4545", "M": "#571919", ".": null },
    pixels: [
      "....O.....O...",
      "....O.....O...",
      "....D.....D...",
      ".....M...M....",
      ".M....LOD....M",
      "..O..OMOMD..O.",
      "..D..OLOOD..D.",
      "...M.OOODD.M..",
      "....M.MMM.M...",
      ".M...MLODM...M",
      "..D..OLOOD..D.",
      "...MMOLOODMM..",
      ".....OOODD....",
      "....M.MMM.M...",
      "...M..OOO..M..",
      "..D..OLLLO..D.",
      "..D..LOODD..D.",
      ".M...LLLLO...M",
      ".....OOODD....",
      ".....LLLOO....",
      ".....OODDM....",
      "......LMM.....",
      "..............",
      "..............",
    ],
  },
  {
    name: "larder1",
    w: 14, h: 24,
    palette: { "O": "#bf6a31", "L": "#e29250", "D": "#ba4545", "M": "#571919", ".": null },
    pixels: [
      "....O.....O...",
      "....O.....O...",
      "....D.....D...",
      ".....M...M....",
      ".M....LOD....M",
      "..O..OMOMD..O.",
      "..D..OLOOD..D.",
      "...M.OOODD.M..",
      "....M.MMM.M...",
      ".M...MLODM...M",
      "..D..OLOOD..D.",
      "...MMOLOODMM..",
      ".....OOODD....",
      "....M.MMM.M...",
      "...M..OOO..M..",
      ".MD..ODDDM..DM",
      ".M..LLOOOOD..M",
      "....OLLLLLO...",
      "....LOOOOOD...",
      "....OLLLLLO...",
      "....LOOOOOD...",
      "....OLLLLLO...",
      "....LOOOOOD...",
      ".....LOODM....",
    ],
  },
  {
    name: "larder2",
    w: 14, h: 24,
    palette: { "O": "#bf6a31", "L": "#e29250", "D": "#ba4545", "M": "#571919", ".": null },
    pixels: [
      "....O.....O...",
      "....O.....O...",
      "....D.....D...",
      ".....M...M....",
      ".M....LOD....M",
      "..O..OMOMD..O.",
      "..D..OLOOD..D.",
      "...M.OOODD.M..",
      "....M.MMM.M...",
      ".M...MLODM...M",
      "..D..OLOOD..D.",
      "...MMOLOODMM..",
      ".....OOODD....",
      "....M.MMM.M...",
      "...M..OOO..M..",
      ".MD.ODDDDMM.DM",
      ".M.LLOOOOODM.M",
      "..OOLLLLLLODM.",
      "..LLOOOOOODMM.",
      "..OOLLLLLLOOD.",
      "..LLOOOOOODMM.",
      "...OLLLLLLOD..",
      "....OOOOOOD...",
      ".....LOODM....",
    ],
  },
  {
    name: "fungus",
    w: 8, h: 8,
    palette: { "C": "#c5dae7", "L": "#e7f7f8", "S": "#7cb2c0", "D": "#3f4d83", ".": null },
    pixels: [
      ".LCCCC..",
      "LLCCCSC.",
      "LCCCSSCC",
      "CCSSCSSD",
      ".CSCSDD.",
      "...SD...",
      "...SD...",
      "..DSSD..",
    ],
  },
  {
    name: "worker2",
    w: 14, h: 20,
    palette: { "O": "#bf4c31", "L": "#ec7732", "D": "#98232c", "M": "#4c1018", "C": "#c5dae7", "S": "#7cb2c0", ".": null, "P": "#3f4d83" },
    pixels: [
      "....O..C..O...",
      "....O.CCS.O...",
      "....D.CSP.D...",
      ".....MSPPM....",
      ".M....LOD....M",
      "..O..OMOMD..O.",
      "..D..OLOOD..D.",
      "...M.OOODD.M..",
      "....M.MMM.M...",
      ".M...MLODM...M",
      "..D..OLOOD..D.",
      "...MMOLOODMM..",
      ".....OOODD....",
      "....M.MMM.M...",
      "...M..LOD..M..",
      "..D..MMMMM..D.",
      "..D..OLOOD..D.",
      ".M...MMMMM...M",
      ".....OLOOD....",
      "......OOD.....",
    ],
  },
];

export const SPRITE_BY_CASTE: Record<string, Sprite> = Object.fromEntries(
  SPRITES.map((s) => [s.name, s]),
);

/** Surface foliage — grows over the session above the colony. */
export const FLORA: Sprite[] = [
  {
    name: "grass · sprout", w: 14, h: 14,
    palette: { "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1f", "M": "#1c4214", ".": null },
    pixels: [
      "..............", "..............", "..............", "..............",
      "..............", "..............", "..............", ".......g......",
      "......gG......", "..g...GG...g..", "..gG..GD..gG..", "..GD..GD..GD..",
      "..GD..GM..GM..", ".MMMMMMMMMMMM.",
    ],
  },
  {
    name: "grass · growing", w: 14, h: 16,
    palette: { "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1f", "M": "#1c4214", ".": null },
    pixels: [
      "..............", "..............", "..............", "..............",
      ".......g......", "......gG......", "......GG......", "......GD......",
      "..g...GD...g..", "..gG..GD..gG..", "..GG.gGD.gGG..", "..GD..GD..GD..",
      "..GD..GM..GD..", "..GD..GM..GD..", "..GM..GM..GM..", ".MMMMMMMMMMMM.",
    ],
  },
  {
    name: "grass · tuft", w: 16, h: 18,
    palette: { "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1f", "M": "#1c4214", ".": null },
    pixels: [
      "................", "................", "................", ".....g..........",
      ".....gG.........", ".....GG..g......", ".....GD..gG.....", "..g..GD..GG.....",
      "..gG.GD.GD.g....", "..GG.GD.GD.gG...", "..GD.GD.GD.GG...", "..GD.GD.GD.GD...",
      "..GD.GD.GD.GD...", "..GD.GD.GD.GD...", "..GD.GM.GD.GM...", "..GD.GM.GM.GM...",
      "..GM.GM.GM.GM...", ".MMMMMMMMMMMMMM.",
    ],
  },
  {
    name: "dandelion · sprout", w: 12, h: 12,
    palette: { "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1f", "M": "#1c4214", ".": null },
    pixels: [
      "............", "............", "............", "............", "............",
      "..g......g..", "..gG....Gg..", ".gGGM..DGGg.", "..gGGMDGGg..", "...gGDDGg...",
      "....MDDM....", ".....MM.....",
    ],
  },
  {
    name: "dandelion · flower", w: 12, h: 18,
    palette: { "Y": "#f2c10f", "y": "#ffe85c", "O": "#d98a16", "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1f", "M": "#1c4214", ".": null },
    pixels: [
      "............", "....yyyy....", "...yYYYYy...", "..yYYOOYYy..", "..yYOOOOYy..",
      "..yYYOOYYy..", "...yYYYYy...", "....yYYy....", ".....DG.....", ".....GD.....",
      ".....DG.....", "..g..GD..g..", "..gG.DG.Gg..", ".gGGMDDGGg..", "..gGGMDGGg..",
      "...gGDDGg...", "....MDDM....", ".....MM.....",
    ],
  },
  {
    name: "dandelion · fluff", w: 12, h: 18,
    palette: { "W": "#f4f0e6", "w": "#cfc7b6", "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1f", "M": "#1c4214", ".": null },
    pixels: [
      ".....W......", "...W.W.W....", "..W.WWW.W...", ".W.WWwWW.W..", "..WWwwwWW...",
      ".W.WwWwW.W..", "..W.WWW.W...", "...W.w.W....", ".....D......", ".....DG.....",
      ".....GD.....", "..g..DG..g..", "..gG.DG.Gg..", ".gGGMDDGGg..", "..gGGMDGGg..",
      "...gGDDGg...", "....MDDM....", ".....MM.....",
    ],
  },
  {
    name: "dandelion · bare", w: 12, h: 18,
    palette: { "w": "#cfc7b6", "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1f", "M": "#1c4214", ".": null },
    pixels: [
      "............", "............", "............", "............", "............",
      ".....w......", "....wDw.....", ".....D......", ".....DG.....", ".....GD.....",
      ".....DG.....", "..g..GD..g..", "..gG.DG.Gg..", ".gGGMDDGGg..", "..gGGMDGGg..",
      "...gGDDGg...", "....MDDM....", ".....MM.....",
    ],
  },
  {
    name: "mushroom · button", w: 10, h: 11,
    palette: { "C": "#c0492e", "c": "#e0704a", "K": "#8a2c1c", "W": "#f4ece0", "S": "#e8dcc4", "d": "#c2b291", "M": "#5c3a0e", ".": null },
    pixels: [
      "..........", "...ccc....", "..cCWCK...", ".cCCCWCK..", ".cCWCCCK..",
      ".KCCCCKK..", "..MKKKM...", "...Wdd....", "...WSd....", "..dWSSd...", "..ddddd...",
    ],
  },
  {
    name: "mushroom · grown", w: 12, h: 14,
    palette: { "C": "#c0492e", "c": "#e0704a", "K": "#8a2c1c", "W": "#f4ece0", "S": "#e8dcc4", "d": "#c2b291", "M": "#5c3a0e", ".": null },
    pixels: [
      "............", "....cccc....", "..ccCWCCCc..", ".cCCCWCCCCK.", ".cCCCCCCWCK.",
      "cCWCCCCCCWCc", "cKCCCWCCCCKc", ".KCCCCCCCKK.", "..MKKKKKKM..", "....Wddd....",
      "....WSSd....", "...WWSSdd...", "...WSSSSd...", "...dddddd...",
    ],
  },
  {
    name: "mushroom · large", w: 14, h: 16,
    palette: { "C": "#c0492e", "c": "#e0704a", "K": "#8a2c1c", "W": "#f4ece0", "S": "#e8dcc4", "d": "#c2b291", "M": "#5c3a0e", ".": null },
    pixels: [
      "..............", ".....cccc.....", "...ccCWCCCc...", "..cCCCWCCCCc..", ".cCCCCCCCWCCK.",
      ".cCWCCCCCCCCK.", "cCCCCCWCCCCCKc", "cKCCWCCCCCWCKc", ".KCCCCCCCCCKK.", "..MKKKKKKKKM..",
      ".....Wddd.....", ".....WSSd.....", "....WWSSdd....", "...dWSSSSdd...", "...dWSSSddd...", "....dddddd....",
    ],
  },
  {
    name: "clover · sprout", w: 9, h: 11,
    palette: { "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1f", "M": "#1c4214", ".": null },
    pixels: [
      ".........", ".........", "...gGg...", "...GGG...", "....M....", "....D....",
      "....G....", "....GD...", "....GD...", "...MDM...", "....M....",
    ],
  },
  {
    name: "clover · pair", w: 10, h: 12,
    palette: { "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1f", "M": "#1c4214", ".": null },
    pixels: [
      "..........", ".GDG..GDG.", ".DDD..DDD.", "..M....M..", "..M....M..", "...DMDD...",
      "....GM....", "....GM....", "....gM....", "....DM....", "...MDDM...", "....MM....",
    ],
  },
  {
    name: "clover · trefoil", w: 11, h: 13,
    palette: { "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1f", "M": "#1c4214", ".": null },
    pixels: [
      "....GDG....", "....DDD....", "GDG..M..GDG", "DDD..D..DDD", ".M...D...M.", "..D..G..D..",
      "...D.G.D...", "....DGM....", ".....GD....", ".....GD....", ".....GD....", ".....DM....", "....MDMM...",
    ],
  },
  {
    name: "leaf", w: 6, h: 8,
    palette: { "G": "#4f9b32", "g": "#8ad457", "D": "#2f6b1e", ".": null },
    pixels: [
      "....g.",
      "..ggGg",
      ".gggGG",
      "gggGGD",
      "gGGGDD",
      ".GGDDD",
      "..GDD.",
      "..D...",
    ],
  },
];

export const FLORA_BY_NAME: Record<string, Sprite> = Object.fromEntries(
  FLORA.map((s) => [s.name, s]),
);

/** Underground fungus the colony farms on its diff — drawn on the chamber floor,
 *  in stages by crop size, with a spent/blighted variant for deletion turns. */
export const FUNGUS: Sprite[] = [
  {
    name: "fungus · spot", w: 6, h: 6,
    palette: { "o": "#bfe6d8", "O": "#86c4b2", "s": "#e6f2ec", "d": "#4a7468", ".": null },
    pixels: [
      "......",
      "..oo..",
      ".oOOo.",
      ".oOOo.",
      "..ss..",
      "..dd..",
    ],
  },
  {
    name: "fungus · cluster", w: 10, h: 6,
    palette: { "o": "#bfe6d8", "O": "#86c4b2", "s": "#e6f2ec", "d": "#4a7468", ".": null },
    pixels: [
      "..........",
      "..oo..oo..",
      ".oOOooOOo.",
      ".oOOooOOo.",
      "..ss..ss..",
      "..dd..dd..",
    ],
  },
  {
    name: "fungus · bloom", w: 14, h: 7,
    palette: { "o": "#cdeee2", "O": "#86c4b2", "s": "#e6f2ec", "d": "#4a7468", ".": null },
    pixels: [
      "..............",
      "..oo..oo..oo..",
      ".oOOooOOooOOo.",
      ".oOOooOOooOOo.",
      "..ss..ss..ss..",
      "..ss..ss..ss..",
      "..dd..dd..dd..",
    ],
  },
  {
    name: "fungus · blight", w: 10, h: 6,
    palette: { "m": "#7a6a4e", "M": "#564a34", "b": "#39301f", ".": null },
    pixels: [
      "..........",
      "..mm..m...",
      ".mMMm.mm..",
      ".mMM..MMm.",
      "..bb...mm.",
      "..b....b..",
    ],
  },
];

export const FUNGUS_BY_NAME: Record<string, Sprite> = Object.fromEntries(
  FUNGUS.map((s) => [s.name, s]),
);

// Each sprite is baked ONCE to a tiny offscreen bitmap (one canvas-pixel per sprite-
// pixel) and then blitted with a single drawImage — instead of a fillRect per pixel
// EVERY frame. That's the difference between hundreds of thousands of draw calls per
// frame (200+ ants × 200+ fungus beds) and a few hundred. Crispness is preserved by
// disabling image smoothing on the target context (the scene does this).
const spriteBitmap = new Map<Sprite, HTMLCanvasElement>();

function bake(s: Sprite): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = s.w; c.height = s.h;
  const cx = c.getContext("2d")!;
  for (let y = 0; y < s.h; y++) {
    const row = s.pixels[y];
    for (let x = 0; x < s.w; x++) {
      const col = s.palette[row[x]];
      if (!col) continue;
      cx.fillStyle = col;
      cx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** Draw a sprite centered on the current origin (caller sets translate/rotate).
 *  `px` is the world size of one sprite pixel. */
export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, px: number): void {
  let bm = spriteBitmap.get(s);
  if (!bm) { bm = bake(s); spriteBitmap.set(s, bm); }
  ctx.drawImage(bm, (-s.w / 2) * px, (-s.h / 2) * px, s.w * px, s.h * px);
}
