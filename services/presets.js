// services/presets.js
//
// Building presets per building type. Each preset overrides a few pills and
// contributes a "design intent" paragraph that gets appended to the main
// prompt at generation time. Lets the user click "Futuristic office" or
// "Zaha-inspired" and have the prompt actually become specific instead of
// generic.

const PRESETS = {
  Office: [
    {
      id: 'office_futuristic_zaha',
      label: 'Futuristic — Zaha Hadid-inspired',
      icon: '\u{1F300}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Glass & Steel', roof: 'Terrace', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: parametric fluid form in the spirit of Zaha Hadid — sweeping double-curved facade, cantilevered floor plates, white precast concrete with frameless structural glazing. Soft continuous lines, no sharp corners. A dramatic sculptural object that is still calm and confident.',
    },
    {
      id: 'office_modern_minimal',
      label: 'Modern minimalist',
      icon: '\u{25A1}',
      pillOverrides: { arch_style: 'Modernist', facade: 'Glass & Steel', roof: 'Flat', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: rigorous modernist office — clean rectilinear volumes, deep aluminium frames, low-iron unitised glazing, expressed concrete soffits inside. Generous double-height entrance lobby with planting visible through the glass. Restrained material palette, precise junctions.',
    },
    {
      id: 'office_foster_tech',
      label: 'Norman Foster-style tech precision',
      icon: '\u{1F4D0}',
      pillOverrides: { arch_style: 'Modernist', facade: 'Glass & Steel', roof: 'Solar panels', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: precision engineering aesthetic in the spirit of Foster + Partners — exposed structural diagrid, brushed steel mullions, full-height glass with subtle silver fritting, integrated photovoltaic louvres. Technical, calm, beautifully detailed.',
    },
    {
      id: 'office_passive_timber',
      label: 'Net-zero passive (CLT timber)',
      icon: '\u{1F333}',
      pillOverrides: { arch_style: 'Scandinavian', facade: 'Timber', roof: 'Solar panels', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: net-zero in operation, mass timber CLT structure expressed externally with charred larch cladding and deep timber-framed windows. Photovoltaic louvres, planted balconies on every floor, cross-ventilation stacks. Warm, low-carbon, calmly confident.',
    },
    {
      id: 'office_breeam_biophilic',
      label: 'BREEAM Outstanding biophilic',
      icon: '\u{1F33F}',
      pillOverrides: { arch_style: 'Biophilic', facade: 'Glass & Steel', roof: 'Green roof', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: biophilic, BREEAM Outstanding office — green walls along the entrance facade, full-height atrium with mature trees, planted setback terraces on every floor, sedum roof. Daylight-responsive louvres. Buildings and planting interlocked as one.',
    },
    {
      id: 'office_brutalist',
      label: 'Brutalist civic monolith',
      icon: '\u{1F9F1}',
      pillOverrides: { arch_style: 'Brutalist', facade: 'Concrete', roof: 'Flat', landscaping: 'Minimal' },
      promptAddendum: 'Design intent: confident brutalist civic monolith — board-marked in-situ concrete, deep punched window openings, expressed structural rhythm. Heavy, monumental, generous floor-to-ceiling heights. Granite paving at ground level.',
    },
  ],

  Residential: [
    {
      id: 'res_brick_balconies',
      label: 'Modern brick apartments + balconies',
      icon: '\u{1F3D8}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Brick', roof: 'Flat', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: high-quality contemporary apartments — handmade brick in mixed warm tones, deep reveals, generous projecting balconies with planters and bronze metalwork railings. Communal landscaped courtyard at ground floor with mature tree planting.',
    },
    {
      id: 'res_sky_garden_tower',
      label: 'Sky-garden tower',
      icon: '\u{1F306}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Glass & Steel', roof: 'Terrace', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: slender residential tower with planted sky gardens at every fifth floor — full-height glazing, bronze anodised mullions, cantilevered planted terraces softening the silhouette. Public roof terrace at the top with mature trees and seating.',
    },
    {
      id: 'res_passivhaus',
      label: 'Passivhaus low-energy',
      icon: '\u{1F31E}',
      pillOverrides: { arch_style: 'Scandinavian', facade: 'Timber', roof: 'Solar panels', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: certified Passivhaus apartments — timber cladding (Siberian larch), deep punched windows with triple glazing, optimised orientation, MVHR exhaust grilles discreetly integrated. Communal planted courtyard, integrated photovoltaics on the roof.',
    },
    {
      id: 'res_coliving',
      label: 'Co-living courtyard',
      icon: '\u{1F465}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Brick', roof: 'Green roof', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: generous co-living scheme arranged around an open landscaped courtyard with shared kitchens, lounges and a co-working space at ground floor. Brick + bronze panel cladding above. Planted communal terraces, secure cycle storage visible from the street.',
    },
    {
      id: 'res_period_contemporary',
      label: 'Period-influenced contemporary',
      icon: '\u{1F3DB}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Brick', roof: 'Pitched', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: contemporary apartments that respect the local period grain — handmade red brick, banded fenestration, projecting cornice and parapet, modern interpretation of bay windows. Traditional proportions modernised with crisp detailing and large glazing.',
    },
    {
      id: 'res_riverside',
      label: 'Riverside high-rise',
      icon: '\u{1F30A}',
      pillOverrides: { arch_style: 'Modernist', facade: 'Glass & Steel', roof: 'Terrace', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: slender riverside residential tower oriented to maximise water views — full-height glazing, cantilevered balconies with glass balustrades, bronze cladding panels. Public riverside walk at ground level with mature planting and outdoor seating.',
    },
  ],

  'Mixed Use': [
    {
      id: 'mu_high_street_regen',
      label: 'High-street regeneration',
      icon: '\u{1F3EA}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Brick', roof: 'Flat', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: active street frontage with cafes and independent retail at ground level — generous timber-framed shopfronts with retractable doors opening to outdoor seating. Brick apartments above with deep reveals and planted balconies. Public realm with new tree planting and granite paving.',
    },
    {
      id: 'mu_cultural_anchor',
      label: 'Cultural anchor + apartments above',
      icon: '\u{1F3AD}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Stone', roof: 'Flat', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: a cultural / event venue at base — double-height fully glazed lobby with exposed stone interior wall, integrated outdoor performance terrace. Stone and bronze residential floors above with deep punched windows. A confident civic gesture.',
    },
    {
      id: 'mu_town_centre_civic',
      label: 'Town-centre civic',
      icon: '\u{1F3DB}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Brick', roof: 'Pitched', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: human-scale town-centre block respecting the existing grain — pitched roofs broken into a rhythm of bays, brick + render facades, ground-floor cafes and small shops with planted spill-out zones. New public square with mature trees.',
    },
  ],

  Retail: [
    {
      id: 'retail_flagship',
      label: 'Department-store flagship',
      icon: '\u{1F6CD}',
      pillOverrides: { arch_style: 'Modernist', facade: 'Stone', roof: 'Flat', landscaping: 'Minimal' },
      promptAddendum: 'Design intent: confident department-store flagship — Portland stone facade with deep brass-framed shopfronts, layered planted setbacks above, integrated signage in flush bronze lettering. Generous canopied entrance with granite paving.',
    },
    {
      id: 'retail_boutique',
      label: 'High-street boutique',
      icon: '\u{1F45C}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Timber', roof: 'Flat', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: small high-street boutique with timber shopfront and discreet signage — full-height glazing showing the curated interior, brass detailing, planted street edge with bench seating. A polite and high-quality piece of street fabric.',
    },
    {
      id: 'retail_showroom',
      label: 'Showroom + workshop',
      icon: '\u{1F3EE}',
      pillOverrides: { arch_style: 'Industrial', facade: 'Glass & Steel', roof: 'Flat', landscaping: 'Minimal' },
      promptAddendum: 'Design intent: showroom + visible workshop — full-height industrial glazing onto the street letting passers-by see the production, exposed steel frame, polished concrete floor. Bronze signage. A working window onto the makers inside.',
    },
  ],

  School: [
    {
      id: 'school_primary',
      label: 'Primary school — timber + courtyard',
      icon: '\u{1F3EB}',
      pillOverrides: { arch_style: 'Scandinavian', facade: 'Timber', roof: 'Pitched', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: domestic-scale primary school arranged around a planted central courtyard — timber-clad gables, large low windows at child eye-level, sheltered colonnade walkways. Soft play landscape with mature trees. Warm, welcoming, calm.',
    },
    {
      id: 'school_sixth_form',
      label: 'Sixth-form college (civic)',
      icon: '\u{1F393}',
      pillOverrides: { arch_style: 'Modernist', facade: 'Brick', roof: 'Flat', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: civic-scale sixth-form college — brick + glass with a generous double-height central commons visible from the street through a fully glazed wall. Planted terraces, study balconies, integrated outdoor amphitheatre seating.',
    },
    {
      id: 'school_university',
      label: 'University academic block',
      icon: '\u{1F4DA}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Stone', roof: 'Flat', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: a serious university academic building — Portland-stone facade with deep punched windows, full-height glazed entrance, integrated bench seating in the colonnade. Calm, scholarly, robust enough to last 100 years.',
    },
  ],

  Hotel: [
    {
      id: 'hotel_boutique',
      label: 'Boutique terracotta + planted',
      icon: '\u{1F3E8}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Terracotta', roof: 'Terrace', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: 60-key boutique hotel — glazed terracotta rainscreen in warm earth tones, full-height bronze-framed windows, planted balconies with bistro tables, ground-floor restaurant spilling onto the pavement under a fabric awning.',
    },
    {
      id: 'hotel_conference',
      label: 'Conference / business hotel',
      icon: '\u{1F4BC}',
      pillOverrides: { arch_style: 'Modernist', facade: 'Glass & Steel', roof: 'Terrace', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: business-grade conference hotel — clean unitised glazing, generous double-height lobby visible from the street, integrated rooftop bar with mature planting and city views, signage in flush brushed brass. Confident, professional.',
    },
    {
      id: 'hotel_waterfront',
      label: 'Waterfront resort (low-rise)',
      icon: '\u{1F3D6}',
      pillOverrides: { arch_style: 'Biophilic', facade: 'Timber', roof: 'Pitched', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: low-rise waterfront resort — timber cladding under deep eaves, indoor-outdoor lobby, planted boardwalks linking the rooms, pool terrace integrated into the landscape. Calm and rooted in place.',
    },
  ],

  Industrial: [
    {
      id: 'ind_logistics_clean',
      label: 'Modern logistics + PV roof',
      icon: '\u{1F69A}',
      pillOverrides: { arch_style: 'Industrial', facade: 'Glass & Steel', roof: 'Solar panels', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: clean modern logistics shed — micro-rib steel cladding in graphite, generous glazed office pod at the corner, photovoltaic array covering the whole roof. Planted bunds soften the perimeter, hedges screening the yard.',
    },
    {
      id: 'ind_maker_sawtooth',
      label: 'Maker space — brick + sawtooth',
      icon: '\u{1F3ED}',
      pillOverrides: { arch_style: 'Industrial', facade: 'Brick', roof: 'Pitched', landscaping: 'Minimal' },
      promptAddendum: 'Design intent: workshops + maker space recalling Victorian industrial heritage — handmade brick with steel-framed sawtooth roof, glazed overhead doors so the workshops open onto the street, bronze signage. Cobbled forecourt with original setts retained.',
    },
    {
      id: 'ind_studio',
      label: 'Light industrial / studio block',
      icon: '\u{1F3A8}',
      pillOverrides: { arch_style: 'Industrial', facade: 'Concrete', roof: 'Flat', landscaping: 'Balanced' },
      promptAddendum: 'Design intent: light-industrial studios for makers + creative businesses — board-marked concrete plinth, full-height industrial glazing above with crittall framing, exposed steel frame inside. Communal planted courtyard for break-out.',
    },
  ],

  Healthcare: [
    {
      id: 'health_hospital',
      label: 'Modern hospital — calm civic',
      icon: '\u{1F3E5}',
      pillOverrides: { arch_style: 'Contemporary', facade: 'Stone', roof: 'Flat', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: calm civic hospital block — Portland-stone facade with deep punched windows, full-height glazed entrance with planted internal atrium visible from the street, calm landscaped forecourt with mature trees and benches. Designed to feel reassuring, not clinical.',
    },
    {
      id: 'health_clinic',
      label: 'Community clinic — residential scale',
      icon: '\u{1FA7A}',
      pillOverrides: { arch_style: 'Scandinavian', facade: 'Timber', roof: 'Pitched', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: small community clinic at residential scale — timber cladding under a pitched roof, low domestic windows, sheltered porch, planted front garden with bench seating. Welcoming, warm, deliberately not institutional.',
    },
    {
      id: 'health_wellness',
      label: 'Wellness centre — biophilic',
      icon: '\u{1F33F}',
      pillOverrides: { arch_style: 'Biophilic', facade: 'Timber', roof: 'Green roof', landscaping: 'Very Green' },
      promptAddendum: 'Design intent: wellness + therapies centre — timber cladding, planted green roof spilling over the eaves, full-height glazing onto a private therapeutic garden, bronze signage. Quiet, contemplative.',
    },
  ],
};

function getPresetById(id) {
  for (const list of Object.values(PRESETS)) {
    for (const p of list) if (p.id === id) return p;
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PRESETS, getPresetById };
}
if (typeof window !== 'undefined') {
  window.SiteScoutPresets = { PRESETS };
}
