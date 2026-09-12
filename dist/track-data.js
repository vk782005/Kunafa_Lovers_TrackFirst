export const TRACKS = {
  AUS: {
    id: 'AUS', name: 'Albert Park', country: 'AUSTRALIA', round: '03', sessionKey: '2026_11361', lengthM: 5278, laps: 58,
    profile: 'Stop-start street circuit with short traction exits and three practical passing windows.',
    geometry: [[300,-15],[230,45],[155,165],[70,245],[-85,230],[-220,135],[-255,0],[-190,-150],[-40,-205],[120,-190],[245,-120],[300,-15]],
    zones: [
      { id:'T1', sector:1, type:'Braking', position:.02, approach:'Turn 1 braking', side:'Inside', note:'Heavy stop after the pit straight.' },
      { id:'T3', sector:1, type:'Overtake', position:.18, approach:'Turn 3', side:'Inside', note:'Primary DRS pass window; late braking is viable.' },
      { id:'T6', sector:2, type:'Braking', position:.35, approach:'Turn 6', side:'Inside', note:'Setup zone for the fast middle sector.' },
      { id:'T9', sector:2, type:'Overtake', position:.52, approach:'Turn 9/10', side:'Inside', note:'Long run and traction determine the move.' },
      { id:'T11', sector:3, type:'Overtake', position:.68, approach:'Turn 11', side:'Outside', note:'High commitment; protect the exit for T12.' },
      { id:'T13', sector:3, type:'Braking', position:.84, approach:'Turn 13', side:'Inside', note:'Final sector positioning opportunity.' }
    ]
  },
  BHR: {
    id: 'BHR', name: 'Sakhir', country: 'BAHRAIN', round: '04', sessionKey: '2026_BHR', lengthM: 5412, laps: 57,
    profile: 'Low-grip desert circuit where rear tyre life and DRS trains dominate the decision.',
    geometry: [[305,-25],[240,35],[255,150],[120,235],[-10,205],[-155,230],[-250,130],[-210,20],[-120,-55],[-230,-170],[-70,-220],[90,-205],[255,-140],[305,-25]],
    zones: [
      { id:'T1', sector:1, type:'Overtake', position:.04, approach:'Turn 1', side:'Inside', note:'Longest braking zone; main DRS release.' },
      { id:'T4', sector:1, type:'Overtake', position:.16, approach:'Turn 4', side:'Inside', note:'Exit traction decides the counter-attack.' },
      { id:'T8', sector:2, type:'Braking', position:.39, approach:'Turn 8', side:'Inside', note:'Tyre management zone before the back straight.' },
      { id:'T10', sector:2, type:'Overtake', position:.52, approach:'Turn 10', side:'Inside', note:'Late move is possible with stable rear grip.' },
      { id:'T11', sector:3, type:'Braking', position:.63, approach:'Turn 11', side:'Inside', note:'Protect the outside on exit.' },
      { id:'T14', sector:3, type:'Overtake', position:.83, approach:'Turn 14', side:'Inside', note:'Final DRS approach and finish-line run.' }
    ]
  },
  JPN: {
    id: 'JPN', name: 'Suzuka', country: 'JAPAN', round: '18', sessionKey: '2026_JPN', lengthM: 5807, laps: 53,
    profile: 'High-speed commitment circuit where aero confidence matters more than straight-line deficit.',
    geometry: [[305,-30],[220,20],[140,125],[40,160],[-25,110],[-120,90],[-210,35],[-260,-65],[-175,-170],[-70,-125],[-10,-205],[110,-220],[235,-160],[305,-30]],
    zones: [
      { id:'T1', sector:1, type:'Overtake', position:.04, approach:'Turn 1', side:'Inside', note:'Only reliable first-sector attack window.' },
      { id:'T11', sector:2, type:'Overtake', position:.47, approach:'Hairpin', side:'Inside', note:'Low-speed rotation and traction are decisive.' },
      { id:'T14', sector:2, type:'Braking', position:.56, approach:'Spoon entry', side:'Inside', note:'Exit speed feeds the back straight.' },
      { id:'T16', sector:3, type:'Overtake', position:.72, approach:'Casio Triangle', side:'Inside', note:'Last-chance braking zone before the line.' }
    ]
  },
  ITA: {
    id: 'ITA', name: 'Monza', country: 'ITALY', round: '16', sessionKey: '2026_ITA', lengthM: 5793, laps: 53,
    profile: 'Slipstream circuit with four heavy stops and a high penalty for poor exit alignment.',
    geometry: [[300,-70],[275,45],[205,160],[75,225],[-85,220],[-225,165],[-270,50],[-220,-95],[-95,-195],[45,-215],[190,-175],[285,-105],[300,-70]],
    zones: [
      { id:'T1', sector:1, type:'Overtake', position:.03, approach:'Rettifilo', side:'Inside', note:'Primary pass; highest closing-speed variance.' },
      { id:'T4', sector:2, type:'Overtake', position:.25, approach:'Roggia', side:'Inside', note:'Requires clean exit from the first chicane.' },
      { id:'T8', sector:2, type:'Braking', position:.48, approach:'Ascari', side:'Inside', note:'Track position is worth more than entry risk.' },
      { id:'T11', sector:3, type:'Overtake', position:.72, approach:'Parabolica', side:'Inside', note:'Exit and DRS run decide the next lap.' }
    ]
  },
  GBR: {
    id: 'GBR', name: 'Silverstone', country: 'GREAT BRITAIN', round: '14', sessionKey: '2026_GBR', lengthM: 5891, laps: 52,
    profile: 'High-speed aero circuit with narrow passing windows and strong dirty-air effects.',
    geometry: [[295,-40],[250,75],[135,185],[15,220],[-105,185],[-235,215],[-285,95],[-220,-25],[-115,-120],[-170,-215],[-15,-225],[105,-175],[180,-75],[295,-40]],
    zones: [
      { id:'T3', sector:1, type:'Overtake', position:.13, approach:'Village', side:'Inside', note:'Short approach; prioritize exit over overlap.' },
      { id:'T6', sector:1, type:'Braking', position:.27, approach:'Brooklands', side:'Inside', note:'Best setup for Luffield traction.' },
      { id:'T9', sector:2, type:'Overtake', position:.46, approach:'Stowe', side:'Inside', note:'DRS plus tyre temperature drives the attack.' },
      { id:'T16', sector:3, type:'Overtake', position:.81, approach:'Club', side:'Inside', note:'Final viable move before the pit straight.' }
    ]
  },
  MCO: {
    id: 'MCO', name: 'Monaco', country: 'MONACO', round: '08', sessionKey: '2026_MCO', lengthM: 3337, laps: 78,
    profile: 'Track-position circuit where qualifying gap and traffic risk outweigh raw pace.',
    geometry: [[275,-10],[210,45],[230,150],[95,215],[-45,185],[-230,210],[-280,105],[-180,10],[-245,-110],[-120,-200],[20,-160],[145,-220],[255,-125],[275,-10]],
    zones: [
      { id:'T1', sector:1, type:'Overtake', position:.06, approach:'Sainte Devote', side:'Inside', note:'Rare clean chance; pit strategy often safer.' },
      { id:'T10', sector:2, type:'Braking', position:.46, approach:'Nouvelle Chicane', side:'Inside', note:'Traffic and yellow flags dominate risk.' },
      { id:'T11', sector:3, type:'Overtake', position:.69, approach:'Portier', side:'Inside', note:'Requires a mistake ahead; tunnel exit is decisive.' }
    ]
  },
  BEL: {
    id: 'BEL', name: 'Spa-Francorchamps', country: 'BELGIUM', round: '13', sessionKey: '2026_BEL', lengthM: 7004, laps: 44,
    profile: 'Long lap with major elevation change and two high-value slipstream approaches.',
    geometry: [[300,-50],[215,35],[245,155],[100,230],[-80,185],[-230,260],[-290,120],[-210,0],[-265,-140],[-130,-205],[20,-185],[120,-245],[260,-160],[300,-50]],
    zones: [
      { id:'T1', sector:1, type:'Overtake', position:.04, approach:'La Source', side:'Inside', note:'Hairpin launch into the Kemmel run.' },
      { id:'T5', sector:1, type:'Overtake', position:.25, approach:'Les Combes', side:'Inside', note:'Slipstream arrival and uphill braking.' },
      { id:'T18', sector:3, type:'Overtake', position:.74, approach:'Bus Stop', side:'Inside', note:'Last chance before the start-finish straight.' }
    ]
  },
  SGP: {
    id: 'SGP', name: 'Marina Bay', country: 'SINGAPORE', round: '15', sessionKey: '2026_SGP', lengthM: 4940, laps: 62,
    profile: 'Hot, bumpy street circuit where tyre degradation and safety-car probability are central.',
    geometry: [[290,-20],[220,80],[110,180],[-35,210],[-205,175],[-275,55],[-245,-70],[-140,-150],[-210,-230],[-50,-220],[90,-190],[240,-140],[290,-20]],
    zones: [
      { id:'T7', sector:1, type:'Overtake', position:.26, approach:'Turn 7', side:'Inside', note:'First meaningful attack after the long run.' },
      { id:'T13', sector:2, type:'Overtake', position:.52, approach:'Turn 13', side:'Inside', note:'Track position matters through the tight complex.' },
      { id:'T14', sector:3, type:'Overtake', position:.64, approach:'Turn 14', side:'Inside', note:'Heavy braking and high lock-up risk.' }
    ]
  }
};

export const DEFAULT_TRACK_ID = 'AUS';
export function getTrack(id) { return TRACKS[id] || TRACKS[DEFAULT_TRACK_ID]; }
export function trackOptions() { return Object.values(TRACKS); }
export function formatTrackLength(m) { return (m / 1000).toFixed(3) + ' km'; }
