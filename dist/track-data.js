export const TRACKS = {
  AUS: {
    id: 'AUS', name: 'Albert Park', country: 'AUSTRALIA', round: '03', sessionKey: '9693', lengthM: 5278, laps: 58,
    profile: 'Stop-start street circuit with short traction exits and three practical passing windows.',
    geometry: [[-36.8,-112.6],[-56.9,-93.4],[-88.1,-63.8],[-105.7,-45.9],[-109.8,-34.3],[-106.1,-11.7],[-112.9,9.0],[-140.8,35.9],[-160.9,56.2],[-180.5,79.1],[-192.2,94.5],[-209.0,119.3],[-217.1,133.6],[-217.0,143.8],[-206.3,149.7],[-186.1,153.2],[-175.7,165.6],[-175.9,179.9],[-178.7,197.9],[-174.9,225.8],[-160.0,240.9],[-133.0,257.8],[-100.4,272.2],[-79.3,283.4],[-58.3,285.0],[-33.4,273.1],[-5.5,266.3],[21.1,244.5],[31.8,221.5],[37.0,198.0],[36.9,163.7],[29.8,135.9],[17.1,101.3],[10.6,64.1],[15.1,35.2],[24.4,12.4],[47.2,-18.6],[75.9,-43.1],[98.4,-49.7],[130.3,-50.3],[151.3,-67.0],[166.1,-79.4],[190.0,-102.4],[204.8,-128.2],[216.1,-160.2],[224.6,-186.7],[231.8,-218.9],[226.0,-228.3],[208.3,-233.5],[181.7,-240.1],[158.4,-244.2],[138.6,-228.1],[126.9,-204.7],[117.9,-189.2],[110.7,-185.3],[103.0,-189.2],[95.7,-200.2],[78.9,-210.6],[61.9,-206.6],[44.3,-191.2],[31.5,-178.7],[7.9,-155.5],[-13.1,-135.1],[-37.6,-111.8]],
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
    id: 'BHR', name: 'Sakhir', country: 'BAHRAIN', round: '04', sessionKey: '10014', lengthM: 5412, laps: 57,
    profile: 'Measured Ocon race line from Sakhir, where rear tyre life and DRS trains dominate the decision.',
    geometry: [[-121.4,-52.2],[-120.0,-18.8],[-118.5,14.6],[-117.1,48.1],[-115.7,81.5],[-114.3,114.9],[-113.0,148.4],[-112.8,181.8],[-109.4,214.8],[-83.5,203.9],[-51.6,202.3],[-18.9,207.9],[14.2,203.0],[47.0,196.4],[79.8,189.8],[112.6,183.4],[145.5,177.3],[178.3,170.9],[194.8,146.9],[172.8,122.6],[146.5,102.1],[126.2,75.5],[103.1,52.4],[69.8,50.5],[40.6,35.4],[21.8,7.8],[0.9,-17.8],[-14.7,4.1],[-8.5,37.0],[-1.3,69.6],[3.7,102.7],[-3.4,134.8],[-29.3,144.2],[-35.0,111.4],[-37.2,78.0],[-38.8,44.6],[-40.4,11.2],[-41.9,-22.3],[-43.6,-55.7],[-45.3,-89.1],[-45.1,-122.5],[-23.9,-144.9],[7.4,-136.1],[27.1,-109.5],[41.3,-79.3],[66.6,-58.3],[99.2,-54.3],[129.9,-67.4],[157.6,-85.4],[155.7,-116.4],[128.2,-135.0],[98.5,-150.5],[69.2,-166.5],[39.9,-182.7],[10.7,-199.0],[-18.6,-215.3],[-47.7,-231.8],[-76.8,-248.3],[-107.7,-260.0],[-128.6,-236.8],[-129.9,-203.5],[-126.7,-170.2],[-125.0,-136.8],[-123.6,-103.4]],
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
    id: 'JPN', name: 'Suzuka', country: 'JAPAN', round: '18', sessionKey: '10006', lengthM: 5807, laps: 53,
    profile: 'Measured Ocon race line from Suzuka, where aero confidence matters more than straight-line deficit.',
    geometry: [[139.3,11.1],[154.3,-6.4],[169.3,-24.0],[184.3,-41.5],[199.2,-59.1],[214.2,-76.7],[229.1,-94.3],[243.2,-112.5],[243.6,-134.7],[228.6,-149.2],[210.3,-137.4],[198.6,-117.5],[181.6,-102.5],[159.4,-97.4],[148.8,-77.7],[136.2,-59.4],[113.5,-55.8],[95.8,-42.2],[98.6,-20.3],[100.8,1.8],[82.6,15.0],[60.4,20.4],[37.8,16.7],[18.7,4.1],[4.6,-14.2],[-11.1,-30.9],[-33.8,-34.9],[-53.5,-27.6],[-57.8,-5.0],[-62.7,17.6],[-66.8,40.3],[-61.6,62.4],[-64.2,80.2],[-77.4,62.0],[-90.5,43.0],[-109.1,29.8],[-131.9,27.5],[-154.5,31.9],[-175.7,40.8],[-193.5,55.3],[-205.1,75.2],[-214.5,96.2],[-231.0,110.7],[-253.4,107.2],[-260.0,87.2],[-245.6,69.6],[-226.8,56.2],[-207.1,44.3],[-186.5,33.7],[-165.1,25.2],[-143.3,17.7],[-121.4,10.4],[-99.5,3.0],[-77.6,-4.3],[-55.7,-11.7],[-33.3,-12.0],[-12.7,-1.8],[5.2,12.7],[21.7,28.8],[39.3,43.5],[60.5,40.2],[80.2,50.9],[102.5,46.1],[120.8,32.3]],
    zones: [
      { id:'T1', sector:1, type:'Overtake', position:.04, approach:'Turn 1', side:'Inside', note:'Only reliable first-sector attack window.' },
      { id:'T11', sector:2, type:'Overtake', position:.47, approach:'Hairpin', side:'Inside', note:'Low-speed rotation and traction are decisive.' },
      { id:'T14', sector:2, type:'Braking', position:.56, approach:'Spoon entry', side:'Inside', note:'Exit speed feeds the back straight.' },
      { id:'T16', sector:3, type:'Overtake', position:.72, approach:'Casio Triangle', side:'Inside', note:'Last-chance braking zone before the line.' }
    ]
  },
  ITA: {
    id: 'ITA', name: 'Monza', country: 'ITALY', round: '15', sessionKey: '2026_11361', lengthM: 5793, laps: 53,
    profile: 'Measured Ocon race line from Monza: long slipstream straights, two chicanes and three high-value braking decisions.',
    geometry: [[-147.7,134.6],[-145.8,113.1],[-143.9,91.5],[-142.0,70.0],[-140.2,48.4],[-138.3,26.9],[-136.5,5.3],[-134.6,-16.2],[-132.8,-37.8],[-131.0,-59.3],[-123.7,-78.1],[-120.9,-96.5],[-124.6,-117.7],[-124.7,-139.3],[-121.6,-160.7],[-113.8,-180.8],[-100.6,-197.8],[-83.1,-210.4],[-63.0,-218.3],[-41.7,-222.1],[-20.2,-224.1],[1.4,-225.6],[23.0,-226.6],[44.5,-228.3],[61.0,-241.3],[82.0,-246.4],[102.4,-253.6],[123.0,-260.0],[142.3,-252.7],[148.3,-232.2],[150.0,-210.6],[151.0,-189.1],[137.6,-173.4],[118.4,-163.4],[99.5,-152.9],[80.7,-142.2],[62.6,-130.4],[45.9,-116.6],[29.6,-102.4],[13.3,-88.3],[-3.1,-74.1],[-19.4,-59.9],[-35.7,-45.7],[-51.3,-30.7],[-54.2,-9.5],[-64.8,8.9],[-72.9,28.6],[-75.0,50.1],[-77.0,71.7],[-79.0,93.2],[-81.0,114.7],[-82.9,136.3],[-84.9,157.8],[-86.9,179.4],[-88.9,200.9],[-91.0,222.4],[-94.4,243.8],[-107.4,260.0],[-128.1,257.1],[-142.5,241.4],[-149.4,221.0],[-151.0,199.4],[-150.5,177.8],[-149.3,156.2]],
    zones: [
      { id:'T1', sector:1, type:'Overtake', position:.131, approach:'Variante del Rettifilo', side:'Inside', note:'Primary DRS pass: Ocon brakes from 301 to 90 km/h here.' },
      { id:'T4', sector:1, type:'Overtake', position:.348, approach:'Variante della Roggia', side:'Inside', note:'Second major pass: measured braking falls from 259 to 118 km/h.' },
      { id:'T6', sector:2, type:'Braking', position:.419, approach:'Lesmo 1', side:'Inside', note:'Short stability-sensitive brake phase before the second Lesmo.' },
      { id:'T8', sector:2, type:'Braking', position:.662, approach:'Variante Ascari', side:'Inside', note:'High-speed braking and exit alignment control the run to Parabolica.' },
      { id:'T11', sector:3, type:'Overtake', position:.871, approach:'Curva Alboreto', side:'Inside', note:'Late-braking opportunity; exit quality determines the finish-line attack.' }
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
    id: 'MCO', name: 'Monaco', country: 'MONACO', round: '08', sessionKey: '2025_9979', lengthM: 3337, laps: 78,
    profile: 'Measured Ocon race line through Monaco, where position, braking precision and traffic matter more than raw pace.',
    geometry: [[-203.0,70.7],[-201.4,43.2],[-196.9,15.9],[-188.5,-10.3],[-164.4,-20.5],[-136.9,-23.6],[-110.0,-29.7],[-83.2,-36.4],[-56.1,-41.4],[-29.3,-47.4],[-4.0,-58.4],[22.5,-66.2],[49.7,-70.4],[75.1,-80.5],[89.7,-103.0],[84.2,-129.8],[69.1,-152.7],[68.2,-179.0],[84.7,-201.0],[101.6,-222.9],[118.1,-245.0],[140.2,-256.7],[151.3,-232.1],[165.9,-209.2],[165.0,-227.1],[163.7,-250.1],[189.2,-260.0],[203.0,-240.2],[200.9,-212.7],[197.8,-185.3],[191.5,-158.5],[181.7,-132.7],[169.0,-108.2],[150.2,-88.3],[126.0,-75.0],[101.3,-62.7],[76.3,-50.9],[50.4,-41.4],[23.4,-35.7],[-4.0,-32.2],[-25.7,-17.4],[-53.1,-18.4],[-80.5,-15.2],[-107.9,-12.0],[-135.4,-9.7],[-160.1,0.6],[-173.3,24.5],[-178.0,51.7],[-172.5,78.1],[-160.5,102.8],[-154.5,129.7],[-153.2,157.2],[-159.5,182.8],[-149.0,208.2],[-130.3,228.1],[-108.9,244.6],[-126.5,260.0],[-152.6,254.6],[-162.0,228.9],[-176.3,205.3],[-185.8,179.4],[-193.2,152.8],[-198.6,125.7],[-201.6,98.3]],
    zones: [
      { id:'T1', sector:1, type:'Overtake', position:.015, approach:'Sainte Devote', side:'Inside', note:'Best conventional chance; measured braking falls from 265 to 120 km/h.' },
      { id:'T5', sector:1, type:'Overtake', position:.303, approach:'Mirabeau Haute', side:'Inside', note:'Low-speed overlap is possible, but the narrow exit makes it high risk.' },
      { id:'T6', sector:2, type:'Braking', position:.352, approach:'Fairmont Hairpin', side:'Inside', note:'Slowest measured brake phase, falling to 51 km/h; passing needs cooperation.' },
      { id:'T10', sector:2, type:'Overtake', position:.588, approach:'Nouvelle Chicane', side:'Inside', note:'Main tunnel-exit attempt; Ocon brakes from 278 to 74 km/h.' },
      { id:'T18', sector:3, type:'Braking', position:.844, approach:'La Rascasse', side:'Inside', note:'Heavy low-speed braking, normally a pressure rather than clean-pass zone.' }
    ]
  },
  BEL: {
    id: 'BEL', name: 'Spa-Francorchamps', country: 'BELGIUM', round: '13', sessionKey: '9939', lengthM: 7004, laps: 44,
    profile: 'Measured Ocon race line from Spa, with major elevation change and two high-value slipstream approaches.',
    geometry: [[-63.5,196.9],[-76.9,217.3],[-90.4,237.6],[-102.5,258.7],[-84.0,260.0],[-62.4,248.7],[-42.5,234.6],[-25.0,217.6],[-8.3,199.8],[8.1,181.8],[27.9,167.9],[38.6,146.6],[47.5,124.2],[61.8,104.4],[75.6,84.3],[86.0,62.3],[93.7,39.2],[101.4,16.0],[109.2,-7.1],[117.0,-30.2],[124.8,-53.4],[132.5,-76.5],[134.7,-100.0],[125.5,-121.0],[129.6,-144.5],[113.0,-161.6],[93.3,-175.9],[73.4,-190.0],[55.7,-181.6],[71.6,-164.5],[87.3,-147.5],[80.4,-124.4],[72.7,-101.2],[67.3,-77.4],[62.1,-53.6],[49.4,-33.5],[25.9,-29.5],[4.3,-39.7],[-8.2,-60.4],[-15.7,-83.6],[-23.1,-106.9],[-35.9,-126.9],[-58.8,-123.4],[-80.4,-130.6],[-92.4,-151.8],[-106.6,-171.2],[-129.0,-165.1],[-145.8,-147.8],[-146.3,-124.0],[-135.8,-102.1],[-120.3,-83.3],[-102.0,-67.3],[-81.2,-54.6],[-60.2,-42.1],[-42.4,-25.7],[-30.5,-4.4],[-21.9,18.4],[-22.2,42.4],[-31.2,65.1],[-40.5,87.7],[-46.5,111.3],[-50.5,135.3],[-39.1,152.5],[-48.2,173.9]],
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
