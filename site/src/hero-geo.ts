// Where the hero shader puts the world, in CSS pixels. Shared by the shader (scripts/hero.ts) and the overlay
// (scripts/hero-fx.ts) so a point on the map lands on the same dot in both.
export const HERO_CENTRE: [number, number] = [10, 22]; // lon, lat drawn at the origin

export function heroGeo(cssW: number, cssH: number) {
  const narrow = cssW < 768;
  // wide: the map spans the width, shifted right so the Americas sit behind the (calm) text block.
  // narrow: the map takes the upper part of the height and crops in longitude.
  // The narrow map has a fixed size at the top of the hero (the text block grows with the card under it).
  const k = narrow ? Math.max(cssW / 380, 1.63) : Math.max(cssW / 380, (cssH * 0.62) / 140);
  const ox = cssW * (narrow ? 0.5 : 0.62);
  const oy = narrow ? 120 : cssH * 0.42;
  const mapBottom = narrow ? oy + 79 * k : 0; // css px below which the text block starts (narrow only)
  const project = (lon: number, lat: number): [number, number] => [ox + (lon - HERO_CENTRE[0]) * k, oy - (lat - HERO_CENTRE[1]) * k];
  return { narrow, k, ox, oy, mapBottom, project };
}
