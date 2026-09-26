export type Pillar = 'empire' | 'money' | 'body' | 'mind' | 'faith' | 'presence' | 'relationships' | 'experiences';
export type Mission = { id: string; pillar: Pillar; title: string; detail: string; minutes: number; date: string; time: string; done: boolean; evidence: string; completedOn?: string; sourceId?: string };
export type MissionIdea = { id: string; pillar: Pillar; title: string; detail: string; minutes: number; proof: string };
export const PILLARS: { id: Pillar; label: string; intent: string; target: number }[] = [
  { id:'empire', label:'EMPIRE', intent:'Build something that serves a real customer.', target:4 },
  { id:'money', label:'MONEY', intent:'Know your numbers. Respect your rules.', target:2 },
  { id:'body', label:'BODY', intent:'Train, refuel, recover, and carry yourself well.', target:4 },
  { id:'mind', label:'MIND', intent:'Study deeply. Turn knowledge into skill.', target:4 },
  { id:'faith', label:'FAITH', intent:'Know God through Scripture, prayer, and practice.', target:7 },
  { id:'presence', label:'PRESENCE', intent:'Grooming, clear speech, composure, and integrity.', target:3 },
  { id:'relationships', label:'RELATIONSHIPS', intent:'Be present. Initiate. Listen. Follow through.', target:3 },
  { id:'experiences', label:'EXPERIENCES', intent:'Leave the usual loop. Explore and participate.', target:1 },
];
export const MISSIONS: MissionIdea[] = [
  {id:'demo',pillar:'empire',title:'Finish one SentryOps demo workflow',detail:'Choose one agency task. Write its finish line, build the smallest useful improvement, and record a short walkthrough.',minutes:60,proof:'Working change + a short demo.'},
  {id:'buyer',pillar:'empire',title:'Understand one buyer’s problem',detail:'Draft five questions about an HR or background-investigation workflow. Identify the right person to ask; prepare a specific request for a conversation.',minutes:30,proof:'Five questions + one relevant contact.'},
  {id:'pitch',pillar:'empire',title:'Sharpen the SentryOps pitch',detail:'Explain the problem, the workflow you improve, and a measurable pilot result. Practice it aloud without promises you cannot support.',minutes:25,proof:'A clear 60-second explanation.'},
  {id:'spec',pillar:'empire',title:'Turn an idea into a build task',detail:'Name the user, the task, and what done looks like. Break it into three implementation steps.',minutes:15,proof:'One small, testable feature brief.'},
  {id:'numbers',pillar:'money',title:'Reconcile your money',detail:'Review balances, upcoming bills, and recent spending. Record facts and the next responsibility; no extra trading required.',minutes:15,proof:'Updated numbers + one next action.'},
  {id:'trade-review',pillar:'money',title:'Review a trade without placing another',detail:'Annotate one existing setup, entry, stop, and rule followed or broken. Write one process lesson.',minutes:25,proof:'One annotated trade journal entry.'},
  {id:'expense',pillar:'money',title:'Find one spending leak',detail:'Check your recurring subscriptions or last seven days of spending. Choose one unnecessary expense to reconsider.',minutes:10,proof:'One expense identified and a decision.'},
  {id:'money-learn',pillar:'money',title:'Understand one financial concept',detail:'Use an official educational source to study one topic: interest, diversification, or account fees. Explain it in your own words.',minutes:30,proof:'A five-sentence explanation, not a trade.'},
  {id:'train',pillar:'body',title:'Complete your planned training',detail:'Follow your existing workout. Record what you did and how you felt. On a recovery day, use the recovery mission instead.',minutes:60,proof:'Workout completed and logged.'},
  {id:'recover',pillar:'body',title:'Take a recovery walk',detail:'Choose a comfortable route, get outside, and return refreshed. Let recovery support your next training session.',minutes:30,proof:'A walk completed.'},
  {id:'meal',pillar:'body',title:'Prepare your next real meal',detail:'Cook or assemble a meal from food you have. Put tomorrow’s meal or grocery needs on a short list.',minutes:25,proof:'Meal ready + next meal planned.'},
  {id:'wind-down',pillar:'body',title:'Protect tonight’s sleep',detail:'Choose a bedtime, set your alarm, prepare tomorrow’s clothes, and charge your phone away from bed.',minutes:10,proof:'A bedtime and a prepared space.'},
  {id:'read',pillar:'mind',title:'Read, then close the book',detail:'Read Disruptive Thinking or your current book. Close it and write three ideas you remember and one you will apply.',minutes:30,proof:'Three takeaways + one application.'},
  {id:'code',pillar:'mind',title:'Build one coding exercise',detail:'Choose one small concept. Write working code, test an example, and explain what you learned.',minutes:50,proof:'Working exercise + your explanation.'},
  {id:'learn',pillar:'mind',title:'Turn a lesson into a useful note',detail:'Watch or read one lesson without switching apps. Produce an example or a one-page summary before moving on.',minutes:25,proof:'An example or a useful page of notes.'},
  {id:'journal',pillar:'mind',title:'Think on paper',detail:'Write what is on your mind, what you control, and the next choice you can make. Keep it honest and concrete.',minutes:10,proof:'One page + one next action.'},
  {id:'scripture',pillar:'faith',title:'Read Scripture in context',detail:'Read a chapter. Write what it says, what it teaches about God, and one way to live it today. Start with James if you need a place.',minutes:20,proof:'A passage reference + one application.'},
  {id:'prayer',pillar:'faith',title:'Make room for prayer',detail:'Put your phone away. Give thanks, speak honestly about what you are facing, and pray for someone else.',minutes:10,proof:'Uninterrupted time in prayer.'},
  {id:'fellowship',pillar:'faith',title:'Take a step into Christian community',detail:'Check your church’s service, small-group, or volunteer information. Choose one gathering and plan how you will attend.',minutes:15,proof:'One gathering selected and scheduled.'},
  {id:'serve',pillar:'faith',title:'Put faith into service',detail:'Ask a family member what would help, or choose a practical act of service. Do it without making it about recognition.',minutes:30,proof:'One act of service completed.'},
  {id:'groom',pillar:'presence',title:'Get ready like you have somewhere to be',detail:'Shower, groom, wear clean clothes, and reset your room. Use what you own; this does not require shopping.',minutes:20,proof:'Ready for the day + a clean space.'},
  {id:'speak',pillar:'presence',title:'Practice speaking with clarity',detail:'Record a one-minute introduction. Listen once. Remove filler, slow down, and record a clearer second version.',minutes:15,proof:'A clearer second recording.'},
  {id:'composure',pillar:'presence',title:'Practice calm attention',detail:'Spend five minutes without a screen. Then approach one task slowly and deliberately instead of rushing between distractions.',minutes:5,proof:'Five uninterrupted minutes.'},
  {id:'promise',pillar:'presence',title:'Keep an overdue promise',detail:'Choose a small commitment you have left hanging. Finish it or communicate honestly about when you can.',minutes:15,proof:'One promise addressed.'},
  {id:'family',pillar:'relationships',title:'Give someone your full attention',detail:'Call or sit with someone you care about. Ask a real question and listen without scrolling.',minutes:20,proof:'One undistracted conversation.'},
  {id:'invite',pillar:'relationships',title:'Initiate a real plan',detail:'Invite a friend to a walk, meal, workout, or local activity. Suggest a specific day and a plan that fits your budget.',minutes:10,proof:'One thoughtful invitation sent by you.'},
  {id:'new-person',pillar:'relationships',title:'Meet someone through a shared interest',detail:'Attend a class, volunteer session, church group, or founder gathering. Introduce yourself and ask about their interest; respect whether they want to talk.',minutes:60,proof:'One genuine conversation, with no pressure.'},
  {id:'follow-up',pillar:'relationships',title:'Follow up with someone you met',detail:'Reference something you actually discussed. Ask a thoughtful question or suggest staying in touch.',minutes:5,proof:'One personal follow-up sent by you.'},
  {id:'local',pillar:'experiences',title:'Choose somewhere new this week',detail:'Open Explore LA, choose a place, verify its hours and cost, and put a date on it.',minutes:15,proof:'One outing on your plan.'},
  {id:'new-skill',pillar:'experiences',title:'Try a beginner experience',detail:'Choose a library workshop, recreation class, art activity, or beginner group. Go to participate, not to perform.',minutes:60,proof:'One new experience tried.'},
  {id:'neighborhood',pillar:'experiences',title:'Explore a different neighborhood',detail:'Pick a public trail, park, or cultural district. Decide your route and transport before leaving; notice something new.',minutes:60,proof:'One new place + one observation.'},
];
export type LocalPlace = {
  id:string;
  area:'Los Angeles';
  kind:'Dining'|'Outdoors'|'Tourist'|'Local'|'Beaches';
  title:string;
  detail:string;
  mission:string;
  url:string;
  source:string;
  cost:string;
  minutes:number;
};
export const PLACES: LocalPlace[] = [
  {id:'griffith',area:'Los Angeles',kind:'Tourist',title:'Griffith Observatory',detail:'See Los Angeles from Griffith Park, explore the observatory, and stay for the city lights if the schedule fits.',mission:'Visit Griffith Observatory',url:'https://griffithobservatory.org/',source:'Griffith Observatory',cost:'Grounds / exhibits: check official site; parking may cost',minutes:120},
  {id:'santa-monica-pier',area:'Los Angeles',kind:'Beaches',title:'Santa Monica Pier + Beach',detail:'Walk the pier, spend time on the beach, and explore the Ocean Front area without rushing the visit.',mission:'Spend an afternoon at Santa Monica Pier and beach',url:'https://santamonicapier.org/',source:'Santa Monica Pier',cost:'Pier access free; attractions / parking vary',minutes:180},
  {id:'venice',area:'Los Angeles',kind:'Beaches',title:'Venice Beach + Boardwalk',detail:'Walk the beach and boardwalk, see the skatepark and public spaces, and take in a different side of LA.',mission:'Explore Venice Beach and the boardwalk',url:'https://www.visitveniceca.com/',source:'Venice Chamber / visitor guide',cost:'Public beach free; parking / food vary',minutes:150},
  {id:'runyon',area:'Los Angeles',kind:'Outdoors',title:'Runyon Canyon',detail:'Take a daytime hike with water and sun protection. Pick a route that matches your conditioning and leave time for the views.',mission:'Hike Runyon Canyon',url:'https://www.laparks.org/runyon',source:'City of Los Angeles Recreation and Parks',cost:'Park access free; transport / parking vary',minutes:90},
  {id:'getty',area:'Los Angeles',kind:'Tourist',title:'The Getty Center',detail:'Spend time with the art, architecture, gardens, and city views. Reserve or verify current entry and parking rules before leaving.',mission:'Visit the Getty Center',url:'https://www.getty.edu/visit/center/',source:'Getty',cost:'Admission / parking: verify official site',minutes:180},
  {id:'grand-central-market',area:'Los Angeles',kind:'Dining',title:'Grand Central Market',detail:'Try a vendor you have never had before and walk the surrounding Downtown blocks while you are there.',mission:'Try a new spot at Grand Central Market',url:'https://grandcentralmarket.com/',source:'Grand Central Market',cost:'Food varies by vendor',minutes:90},
  {id:'farmers-market',area:'Los Angeles',kind:'Dining',title:'The Original Farmers Market',detail:'Walk the market, pick one meal or snack from a new vendor, and explore the neighboring area.',mission:'Eat somewhere new at the Original Farmers Market',url:'https://farmersmarketla.com/',source:'The Original Farmers Market',cost:'Food varies by vendor',minutes:90},
  {id:'arts-district',area:'Los Angeles',kind:'Local',title:'Arts District + Little Tokyo',detail:'Spend a few hours walking, eating, and exploring galleries, shops, murals, and public spaces rather than only hitting a tourist stop.',mission:'Explore the Arts District and Little Tokyo',url:'https://www.discoverlosangeles.com/things-to-do/discover-the-arts-district-in-downtown-los-angeles',source:'Discover Los Angeles',cost:'Walking is free; food / parking vary',minutes:180},
  {id:'manhattan-beach',area:'Los Angeles',kind:'Beaches',title:'Manhattan Beach + Pier',detail:'Walk the strand and pier, spend time by the water, and explore the local downtown area nearby.',mission:'Explore Manhattan Beach and the pier',url:'https://www.manhattanbeach.gov/departments/parks-and-recreation/beach-and-pier',source:'City of Manhattan Beach',cost:'Beach access free; parking / food vary',minutes:150},
  {id:'malibu-lagoon',area:'Los Angeles',kind:'Outdoors',title:'Malibu Lagoon / Surfrider Beach',detail:'Plan a coastal day around the lagoon and beach. Check conditions, parking, and posted rules before going.',mission:'Take a Malibu Lagoon and Surfrider Beach day',url:'https://www.parks.ca.gov/?page_id=835',source:'California State Parks',cost:'Check parking / day-use fees',minutes:180},
];

export function recentDays(end: string) { const [y,m,d]=end.split('-').map(Number); return Array.from({length:7},(_,i)=>{const date=new Date(y,m-1,d-i,12);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}); }
export function weeklyPillarDays(missions: Mission[], end: string, pillar: Pillar) { const dates=new Set(recentDays(end));return new Set(missions.filter(m=>m.done&&m.pillar===pillar&&dates.has(m.completedOn||m.date)).map(m=>m.completedOn||m.date)).size; }
