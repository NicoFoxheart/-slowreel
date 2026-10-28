// Cabin PA: ready-made captain/crew announcements (EN, with ES/KO versions of most), typed custom
// announcements, ding-dong chime and PA hiss via Web Audio, speech via speechSynthesis.
const ES_CITY = { KTPA: 'Tampa', KMIA: 'Miami', RKSI: 'Incheon', RKSS: 'Gimpo', KLAX: 'Los Ángeles', MPTO: 'Ciudad de Panamá', KJFK: 'Nueva York', KSFO: 'San Francisco', RJTT: 'Tokio', EGLL: 'Londres', OMDB: 'Dubái', WSSS: 'Singapur' };
const KO_CITY = { KTPA: '탬파', KMIA: '마이애미', RKSI: '인천', RKSS: '김포', KLAX: '로스앤젤레스', MPTO: '파나마시티', KJFK: '뉴욕', KSFO: '샌프란시스코', RJTT: '도쿄', EGLL: '런던', OMDB: '두바이', WSSS: '싱가포르' };
const WX = { clear: ['clear skies', 'cielo despejado', '맑은 날씨'], scattered: ['a few clouds', 'algunas nubes', '구름 조금'], overcast: ['overcast skies', 'cielo nublado', '흐린 날씨'], rain: ['some rain', 'algo de lluvia', '비'], fog: ['fog', 'niebla', '안개'] };
const hm = m => { const h = Math.floor(m / 60), mm = Math.round(m % 60); return { h, mm }; };
export const PA_LINES = [
  { id: 'welcome', who: 'captain', label: 'Welcome aboard', boost: 4,
    en: c => `Ladies and gentlemen, ${c.greet}, this is your captain speaking. Welcome aboard Nicofoxheart Air flight four one two from ${c.o} to ${c.d}. Our flight time today will be ${c.ftEn}, and we'll be cruising at ${c.cruiseEn}. Please sit back, relax, and enjoy the flight.`,
    es: c => `Señoras y señores, ${c.greetEs}, les habla su capitán. Bienvenidos a bordo del vuelo cuatro uno dos de Nicofoxheart Air, de ${c.oEs} a ${c.dEs}. Nuestro tiempo de vuelo será de ${c.ftEs}. Relájense y disfruten del vuelo.`,
    ko: c => `손님 여러분, 안녕하십니까. 기장입니다. ${c.oKo}에서 ${c.dKo}까지 가는 니코폭스하트 항공 412편에 탑승해 주셔서 감사합니다. 비행 시간은 약 ${c.ftKo}입니다. 편안한 여행 되십시오.` },
  { id: 'belt_on', who: 'crew', label: 'Seatbelt sign on', boost: 2, sign: true,
    en: () => 'Ladies and gentlemen, the captain has turned on the fasten seatbelt sign. Please return to your seats and keep your seatbelts securely fastened.',
    es: () => 'Señoras y señores, el capitán ha encendido la señal de abrocharse los cinturones. Por favor regresen a sus asientos y mantengan sus cinturones abrochados.',
    ko: () => '손님 여러분, 좌석벨트 표시등이 켜졌습니다. 자리로 돌아가셔서 좌석벨트를 단단히 매 주시기 바랍니다.' },
  { id: 'belt_off', who: 'captain', label: 'Seatbelt sign off', boost: 2, sign: false,
    en: () => 'Ladies and gentlemen, the captain has turned off the seatbelt sign. You are now free to move about the cabin, but we recommend keeping your seatbelt fastened while seated.',
    es: () => 'Señoras y señores, el capitán ha apagado la señal de cinturones. Pueden moverse por la cabina, pero les recomendamos mantener el cinturón abrochado mientras estén sentados.',
    ko: () => '손님 여러분, 좌석벨트 표시등이 꺼졌습니다. 기내에서 자유롭게 이동하실 수 있지만, 앉아 계실 때는 좌석벨트를 매 주시기 바랍니다.' },
  { id: 'crew_takeoff', who: 'captain', label: 'Cabin crew, prepare for takeoff', boost: 1,
    en: () => 'Cabin crew, please be seated for takeoff.', es: () => 'Tripulación de cabina, tomen asiento para el despegue.', ko: () => '승무원은 이륙을 위해 착석해 주십시오.' },
  { id: 'cruise', who: 'captain', label: 'Cruise altitude reached', boost: 2,
    en: c => `Ladies and gentlemen, we've reached our cruising altitude of ${c.cruiseEn}. The weather in ${c.d} is ${c.wxEn}, and we expect to arrive on time. The crew will be coming through the cabin shortly with drinks and snacks.`,
    es: c => `Señoras y señores, hemos alcanzado nuestra altitud de crucero. En ${c.dEs} hay ${c.wxEs} y esperamos llegar a tiempo.`,
    ko: c => `손님 여러분, 순항 고도에 도달했습니다. ${c.dKo}의 날씨는 ${c.wxKo}이며, 정시에 도착할 예정입니다.` },
  { id: 'turbulence', who: 'captain', label: 'Turbulence ahead', boost: 3, sign: true,
    en: () => 'Ladies and gentlemen, we are expecting some turbulence ahead. Please return to your seats and fasten your seatbelts. Cabin crew, please be seated.',
    es: () => 'Señoras y señores, esperamos algo de turbulencia. Por favor regresen a sus asientos y abróchense el cinturón.',
    ko: () => '손님 여러분, 잠시 후 기류가 불안정한 지역을 통과할 예정입니다. 자리에 앉아 좌석벨트를 매 주십시오.' },
  { id: 'descent', who: 'captain', label: 'Beginning our descent', boost: 2,
    en: c => `Ladies and gentlemen, we have begun our descent into ${c.d}. Please make sure your seat backs and tray tables are in their upright position and your seatbelt is fastened.`,
    es: c => `Señoras y señores, hemos iniciado el descenso hacia ${c.dEs}. Por favor coloquen el respaldo y la mesa en posición vertical.`,
    ko: c => `손님 여러분, 우리 비행기는 ${c.dKo}을 향해 강하를 시작했습니다. 좌석 등받이와 테이블을 제자리로 해 주십시오.` },
  { id: 'crew_landing', who: 'captain', label: 'Cabin crew, prepare for landing', boost: 1,
    en: () => 'Cabin crew, please prepare the cabin for landing.', es: () => 'Tripulación de cabina, preparen la cabina para el aterrizaje.', ko: () => '승무원은 착륙 준비를 해 주십시오.' },
  { id: 'arrival', who: 'crew', label: 'Welcome to the destination', boost: 3,
    en: c => `Ladies and gentlemen, welcome to ${c.d}. The local time is ${c.timeEn} and the temperature is ${c.temp} degrees Celsius with ${c.wxEn}. Please remain seated until the seatbelt sign is turned off. Thank you for flying Nicofoxheart Air.`,
    es: c => `Señoras y señores, bienvenidos a ${c.dEs}. La hora local es ${c.timeEs} y la temperatura es de ${c.temp} grados con ${c.wxEs}. Gracias por volar con Nicofoxheart Air.`,
    ko: c => `손님 여러분, ${c.dKo}에 오신 것을 환영합니다. 현지 시각은 ${c.timeKo}이며 기온은 섭씨 ${c.temp}도, ${c.wxKo}입니다. 니코폭스하트 항공을 이용해 주셔서 감사합니다.` },
];
export class PA {
  constructor(audio) { this.audio = audio; this.lang = 'en'; this.last = {}; this.log = []; }
  context(c) { // c: { origin, dest (apt objects), distNm, cruiseFt, destLocalMin, temp, wx, localMin }
    const ft = Math.round((c.distNm || 200) / 450 * 60 + 25); const { h, mm } = hm(ft);
    const ftEn = h ? `${h} hour${h > 1 ? 's' : ''}${mm ? ` and ${mm} minutes` : ''}` : `${mm} minutes`, ftEs = h ? `${h} hora${h > 1 ? 's' : ''}${mm ? ` y ${mm} minutos` : ''}` : `${mm} minutos`, ftKo = h ? `${h}시간${mm ? ` ${mm}분` : ''}` : `${mm}분`;
    const t = hm(((c.destLocalMin % 1440) + 1440) % 1440); const ampm = t.h >= 12 ? 'p.m.' : 'a.m.'; const h12 = ((t.h + 11) % 12) + 1;
    const greet = c.localMin < 690 ? 'good morning' : c.localMin < 1050 ? 'good afternoon' : 'good evening', greetEs = c.localMin < 720 ? 'buenos días' : c.localMin < 1140 ? 'buenas tardes' : 'buenas noches';
    const w = WX[c.wx] || WX.clear; const cruiseEn = c.cruiseFt >= 18000 ? `flight level ${Math.round(c.cruiseFt / 100)}, or ${Math.round(c.cruiseFt / 1000)} thousand feet` : `${Math.round(c.cruiseFt / 1000)} thousand feet`;
    this.c = { o: short(c.origin), d: short(c.dest), oEs: ES_CITY[c.origin.icao] || short(c.origin), dEs: ES_CITY[c.dest.icao] || short(c.dest), oKo: KO_CITY[c.origin.icao] || short(c.origin), dKo: KO_CITY[c.dest.icao] || short(c.dest),
      ftEn, ftEs, ftKo, cruiseEn, greet, greetEs, temp: c.temp, wxEn: w[0], wxEs: w[1], wxKo: w[2], timeEn: `${h12}:${String(t.mm).padStart(2, '0')} ${ampm}`, timeEs: `${t.h}:${String(t.mm).padStart(2, '0')}`, timeKo: `${t.h >= 12 ? '오후' : '오전'} ${h12}시 ${t.mm}분` };
    return this.c;
  }
  voiceFor(lang) { let vs = []; try { vs = speechSynthesis.getVoices(); } catch (e) { } const rank = v => (/natural|neural/i.test(v.name) ? 3 : 0) + (/online|google/i.test(v.name) ? 2 : 0); return vs.filter(v => v.lang.toLowerCase().startsWith(lang)).sort((a, b) => rank(b) - rank(a))[0] || null; }
  // returns { text, lang actually used, note }
  announce(id, custom) {
    const L = PA_LINES.find(l => l.id === id); let lang = this.lang, text, note = '';
    if (custom != null) text = custom; else { const f = L[lang] || L.en; text = f(this.c || {}); if (!L[lang]) { lang = 'en'; note = 'No ' + this.lang.toUpperCase() + ' version of this line; spoken in English.'; } }
    if (custom != null) lang = /[\uac00-\ud7af]/.test(custom) ? 'ko' : /[ñáéíóú¿¡]/i.test(custom) ? 'es' : lang === 'ko' ? 'en' : lang; // typed text: pick the voice from the script
    let voice = this.voiceFor(lang === 'ko' ? 'ko' : lang === 'es' ? 'es' : 'en');
    if (!voice && lang !== 'en' && custom == null) { note = `No ${lang === 'ko' ? 'Korean' : 'Spanish'} voice is installed in this browser; shown in ${lang === 'ko' ? 'Korean' : 'Spanish'}, spoken in English.`; voice = this.voiceFor('en'); text = (L.en)(this.c || {}) ; }
    this.log.push({ id: id || 'custom', text, lang, t: Date.now() }); if (this.log.length > 30) this.log.shift();
    const A = this.audio; A && A.paChime && A.paChime();
    const said = custom != null ? custom : (L[this.lang] || L.en)(this.c || {});
    setTimeout(() => {
      A && A.paHiss && A.paHiss(true); let done = false; const fin = () => { if (done) return; done = true; A && A.paHiss && A.paHiss(false); };
      try {
        if (A?.voice !== false && 'speechSynthesis' in window) {
          const chunks = text.split(/(?<=[.。])\s*/).filter(Boolean);
          chunks.forEach((c, i) => { const u = new SpeechSynthesisUtterance(c); try { if (voice) u.voice = voice; } catch (e) { } u.lang = voice?.lang || (lang === 'ko' ? 'ko-KR' : lang === 'es' ? 'es-ES' : 'en-US'); u.rate = 0.95; u.pitch = L?.who === 'crew' ? 1.15 : 0.95; u.volume = Math.min(1, (A?.vol ?? 0.7) + 0.2); if (i === chunks.length - 1) { u.onend = fin; u.onerror = fin; } speechSynthesis.speak(u); });
        }
      } catch (e) { }
      setTimeout(fin, Math.min(30000, 1500 + text.length * 70));
    }, 1300);
    return { text: said, spokenText: text, lang, note, boost: L ? L.boost : 1, sign: L ? L.sign : undefined };
  }
}
function short(a) { return ({ KTPA: 'Tampa', KMIA: 'Miami', RKSI: 'Seoul Incheon', RKSS: 'Seoul Gimpo', KLAX: 'Los Angeles', MPTO: 'Panama City', KJFK: 'New York', KSFO: 'San Francisco', RJTT: 'Tokyo Haneda', EGLL: 'London Heathrow', OMDB: 'Dubai', WSSS: 'Singapore' })[a.icao] || a.city || a.name; }
