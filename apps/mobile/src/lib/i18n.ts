/**
 * The app's two languages, and the one a person chose.
 *
 * CLAUDE.md says the interface is bilingual and that neither language is a translation
 * layer over the other. Until now that was only half true: every string was Turkish, and
 * the *assistant's* language was guessed from the question by a word list on the server.
 * The guess drifted — three Turkish scenarios in a full evaluation run came back in
 * English — and there was nothing to check it against, because nothing had ever been
 * decided. A preference decides it. The server is told rather than left to infer, and a
 * told language can be a gate (`right_language` in `validation.py`).
 *
 * No i18n library. The whole surface is the object below, and `en` is typed as
 * `typeof tr`, so a missing or misspelled key is a compile error rather than a key name
 * appearing on screen in front of someone. A library would add a dependency, a runtime
 * lookup and a class of silent misses, in exchange for plural rules and interpolation
 * that a function in a dictionary already does.
 *
 * Strings that take a value are functions rather than templates with placeholders. Turkish
 * agglutinates and English does not, so `{count} profiles` cannot be assembled from parts
 * that work in both — the sentence has to be written twice, and writing it as a function
 * is what makes that obvious.
 */

import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

export type Language = "tr" | "en";

const LANGUAGE_KEY = "weatherapp.language";

/**
 * What to open in before anyone has chosen.
 *
 * The device's own locale, which is the only signal available and is usually right.
 * Turkish when the device says Turkish, English otherwise — not "Turkish unless proven
 * otherwise", because a person whose phone is in German is better served by the language
 * they are more likely to read than by the language this project happens to be written in.
 */
function deviceLanguage(): Language {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? "";
    return locale.toLowerCase().startsWith("tr") ? "tr" : "en";
  } catch {
    return "tr";
  }
}

type LanguageState = {
  language: Language;
  /** False until the keystore has been read, so nothing renders the wrong language. */
  restored: boolean;
  restore: () => Promise<void>;
  setLanguage: (language: Language) => void;
};

export const useLanguageStore = create<LanguageState>((set) => ({
  language: deviceLanguage(),
  restored: false,
  restore: async () => {
    try {
      const stored = await SecureStore.getItemAsync(LANGUAGE_KEY);
      if (stored === "tr" || stored === "en") set({ language: stored, restored: true });
      else set({ restored: true });
    } catch {
      // The device default stands for this launch. A language that failed to load is
      // not worth a failure screen.
      set({ restored: true });
    }
  },
  setLanguage: (language) => {
    set({ language });
    void SecureStore.setItemAsync(LANGUAGE_KEY, language).catch(() => {
      // Lost at next launch, which is annoying rather than broken.
    });
  },
}));

/** The chosen language, reactively. */
export function useLanguage(): Language {
  return useLanguageStore((state) => state.language);
}

/**
 * The chosen language, outside React.
 *
 * For the formatting helpers in `plan.ts` and `ask.ts`, which are plain functions called
 * from render and from worklets' callbacks alike. They take the language as an argument;
 * this is what the few callers that have no other way to get one use.
 */
export function currentLanguage(): Language {
  return useLanguageStore.getState().language;
}

/** Every string the interface shows, reactively. */
export function useCopy(): Copy {
  return COPY[useLanguage()];
}

const tr = {
  languageName: "Türkçe",

  tabs: { trace: "İz", ask: "Sor", you: "Sen" },
  span: { day: "24 saat", week: "7 gün" },

  common: {
    cancel: "Vazgeç",
    save: "Kaydet",
    delete: "Sil",
    edit: "Düzenle",
    copy: "Kopyala",
    loading: "Yükleniyor…",
    retry: "Tekrar dene",
  },

  weather: {
    clear: "Açık",
    partly: "Parçalı bulutlu",
    overcast: "Kapalı",
    fog: "Sisli",
    "light-rain": "Hafif yağmurlu",
    freezing: "Dondurucu yağmur",
    downpour: "Sağanak",
    snow: "Karlı",
    hail: "Dolu",
    storm: "Fırtınalı",
  },

  measure: { temperature: "Sıcaklık", wind: "Rüzgâr", precipitation: "Yağış" },

  activities: { running: "Koşu", cycling: "Bisiklet", picnic: "Piknik" },

  constraints: {
    temperature: "Sıcaklık",
    wind: "Rüzgâr",
    precipitation: "Yağış",
    uv: "UV",
    severe_weather: "Sert hava",
    time_of_day: "Saat",
  },

  verdict: { good: "Uygun", mixed: "Kısmen", bad: "Uygun değil" },

  weekdays: [
    "Pazar",
    "Pazartesi",
    "Salı",
    "Çarşamba",
    "Perşembe",
    "Cuma",
    "Cumartesi",
  ],
  weekdaysShort: ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"],
  months: [
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
  ],
  today: "Bugün",

  age: {
    justNow: "az önce",
    minutes: (n: number) => `${n} dk önce`,
    hours: (n: number) => `${n} sa önce`,
    days: (n: number) => `${n} gün önce`,
  },

  card: {
    /** "5 Eylül" in Turkish, "September 5" in English — the order is not translatable. */
    date: (day: number, month: string) => `${day} ${month}`,
    upTo: (deg: number) => `${deg} dereceye kadar`,
    openHours: (hours: number, best: string) =>
      `${hours} saat uygun, en iyisi ${best}`,
    noOpenHours: "uygun saat yok",
    noneOpen: "Uygun saat yok",
  },

  trace: {
    fetching: "Tahmin alınıyor",
    bestWindow: (profile: string) => `${profile} için haftanın en iyi penceresi.`,
    stale: (age: string) => `Sunucuya ulaşılamıyor. Bu iz ${age} alınan tahminden.`,
    nothingClears: "Bu hafta hiçbir saat sınırlarını geçmiyor",
    blocker: (constraint: string, hours: number) =>
      `${constraint} limitin tek başına ${hours} saati eledi.`,
    stalePrefix: "bayat · ",
    refresh: "Yenile",
    noResult: (profile: string) => `${profile} profilin için sonuç yok.`,
    dayHelp: (profile: string) =>
      `Çizgi ne kadar yüksekse o saat ${profile} için o kadar uygun. Kehribar bölümler sınırlarını geçen pencereler.`,
    weekHelp:
      "Her kart bir gün. Kehribar bantlar sınırlarını geçen saatler; hepsi aynı 00–24 ekseninde, böylece açık saatler haftada bir sütun olarak okunur. Bir karta dokun, o günün izini aç.",
    precip: (pct: number) => `yağış %${pct}`,
  },

  ask: {
    intro: (place: string) =>
      `İz ekranının cevaplamadığı her şeyi buraya sorabilirsin. Cevaplar ${place} için, model cihazda çalışıyor — sorun hiçbir yere gitmiyor.`,
    examplesLabel: "Örnek sorular",
    examples: [
      "Bu hafta koşu için en iyi zaman ne zaman?",
      "Yarın sabah koşabilir miyim?",
      "Hafta sonu piknik yapmayı düşünüyoruz, ne dersin?",
    ],
    placeholder: "Bir şey sor",
    send: "Gönder",
    longPressHint: "Uzun bas: kopyala veya düzenle",
    yesterday: "Dün",
    /** Said once, at the top of the thread, so the cap is not a silent deletion. */
    kept: (n: number) => `Son ${n} soru bu telefonda saklanıyor.`,
    close: "Kapat",
    sendLabel: "Sor",
    saveAndAsk: "Kaydet ve yeniden sor",
    fromEngine: "Asistan cevap veremedi, bu yanıt skorlama motorundan.",
    phases: {
      gathering: "Hava verisi alınıyor",
      composing: "Cevap yazılıyor",
      repairing: "Cevap kontrolden geçmedi, yeniden yazılıyor",
    },
    provenance: {
      noTools: "araç yok",
      tools: (n: number) => `${n} araç`,
      onDevice: "cihazda",
      fromEngine: "motordan",
      seconds: (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} sn`,
    },
    readings: {
      windValue: (kmh: number) => `${kmh} km/sa`,
      precipNone: "yok",
      precipValue: (pct: number) => `%${pct}`,
      degrees: (low: number, high: number) =>
        low === high ? `${low}°` : `${low}–${high}°`,
    },
  },

  places: {
    none: (place: string) =>
      `Kayıtlı yerin yok. Uygulama şimdilik ${place} için çalışıyor; buradan kendi yerini eklersen ona geçer.`,
    useMine: "Konumumu kullan",
    locating: "Konum alınıyor…",
    mine: "konumum",
    refused:
      "Konum izni verilmedi. Yerini aşağıdan arayarak ekleyebilirsin — uygulamanın geri kalanı aynı şekilde çalışır.",
    add: "Yer ekle",
    searchPlaceholder: "Şehir veya semt",
    searchFailed: "Yer araması şu an çalışmıyor. Sunucuya ulaşılabiliyor mu, kontrol et.",
    here: "Konumum",
  },

  you: {
    settings: "Ayarlar",
    title: "Sen",
    account: "Hesap",
    guestLabel: "Misafirsin",
    pending: "Bildirimler ve asistan durumu buraya gelecek.",
    language: "Dil",
    languageHelp:
      "Arayüz ve asistanın cevapları bu dilde olur. Asistana da bu tercih gönderilir, böylece cevabın dili tahmin edilmez.",
    signedIn:
      "Profillerin ve konumların bu hesaba kayıtlı. Uygulamayı silip kursan da duruyorlar.",
    signOut: "Çıkış yap",
    signingOut: "Çıkılıyor…",
    unmovedLabel: "Taşınmamış profiller",
    unmoved: (n: number) =>
      `Bu telefonda, hesabına bağlı olmayan ${n} profil var. Taşırsan başka cihazdan da açılır.`,
    moveToAccount: "Hesabıma taşı",
    moving: "Taşınıyor…",
    guest:
      "Her şey çalışıyor ve hiçbir şey cihazından çıkmıyor. Profillerin bu telefonda saklanıyor. Hesap açarsan sunucuna kaydolur, ikinci cihazından da açılır.",
    signInOrUp: "Hesap aç veya giriş yap",
    places: "Yerler",
  },

  profiles: {
    label: "Profiller",
    newProfile: "Yeni profil",
    newProfileName: "Yeni profil",
    saving: "Kaydediliyor…",
    failed: "Profiller alınamadı. Sen sekmesini yeniden aç.",
    none: "Kayıtlı profilin yok. İz şimdilik hazır üç profille çalışıyor; buradan kendi profilini kaydedersen çipler ondan gelir.",
    saveBuiltIns: "Hazır üçünü kaydet",
    tempMin: "En düşük sıcaklık",
    tempMax: "En yüksek sıcaklık",
    windMax: "Rüzgâr limiti",
    precipMax: "Yağış ihtimali",
    hoursFrom: "Tercih ettiğin saatler — başlangıç",
    hoursTo: "Tercih ettiğin saatler — bitiş",
    inverted: "En düşük sıcaklık, en yüksekten büyük olamaz.",
    increase: (label: string) => `${label} artır`,
    decrease: (label: string) => `${label} azalt`,
    windUnit: "km/sa",
  },

  tour: {
    skip: "Geç",
    next: "Devam",
    start: "Başla",
    again: "Tanıtımı tekrar göster",
    step: (at: number, of: number) => `${at}. adım, ${of} adımdan`,
    pages: [
      {
        title: "Ne zaman?",
        body: "Kaç derece olduğunu zaten biliyorsun. Bu uygulama sana ne zaman çıkacağını söyler — koşuya, yürüyüşe, pikniğe. Yüksek yerler o saatin sana uygunluğu; sıcaklık değil.",
      },
      {
        title: "Sınırları sen koy",
        body: "Kaça kadar sıcak? Ne kadar rüzgâr? Yağmur ihtimali kaçta vazgeçersin? Bir kez söylersin, hesabı o yapar. Kehribar saatler senin geçtiğin saatler.",
      },
      {
        title: "Sor, yeter",
        body: "\u201cHafta sonu piknik olur mu?\u201d diye sor, cevabını al. Sorduğun hiçbir şey telefonundan dışarı çıkmaz.",
      },
    ],
  },

  welcome: {
    /** Not a tagline. The one sentence that says which weather app this is. */
    pitch:
      "Hava kaç derece değil, ne zaman çıkman gerektiğini söyler. Model senin sunucunda çalışır — sorduğun hiçbir şey başka bir yere gitmez.",
    signUp: "Hesap aç",
    signIn: "Giriş yap",
    asGuest: "Hesapsız devam et",
    guestTitle: "Her şey hesapsız çalışır.",
    guestBody:
      "Profillerin ve yerlerin bu telefonda kalır; sunucuya hiçbir şey gitmez. Hesap açarsan bunlar sunucuna kaydolur, telefon değiştirsen de durur. Sonradan da açabilirsin.",

    email: "E-posta",
    emailPlaceholder: "ornek@site.com",
    password: "Parola",
    passwordPlaceholder: (min: number) => `En az ${min} karakter`,
    passwordHint: (min: number) =>
      `En az ${min} karakter. Uzunluk işe yarar, karakter çeşidi yaramaz.`,
    back: "Geri",
    carryOn: "Devam et",

    onThisDevice: "Bu telefondaki profiller",
    offer: (count: string) =>
      `Hesapsızken ${count} profil oluşturmuşsun. Hesabına taşıyalım mı? Taşırsan başka cihazdan da açılır; taşımazsan burada kalmaya devam eder.`,
    movedTitle: "Taşındı",
    partlyMovedTitle: "Bir kısmı taşındı",
    moved: (n: number) => `${n} profil hesabına kaydedildi.`,
    failedToMove: (n: number) =>
      ` ${n} tanesi gönderilemedi; telefonda duruyorlar, Sen sekmesinden tekrar deneyebilirsin.`,
    keepForNow: "Burada kalsın",

    unreachable:
      "Sunucuya ulaşılamadı. Backend çalışıyor mu ve aynı ağda mısın, kontrol et.",
    wrongCredentials: "E-posta veya parola hatalı.",
    accountExists: "Bu adreste zaten bir hesap var. Giriş yapmayı dene.",
    invalid: (min: number) =>
      `Adres geçerli bir e-posta olmalı, parola en az ${min} karakter.`,
    refused: "Girilen bilgiler kabul edilmedi.",
    tooMany: "Çok fazla deneme oldu. Birkaç dakika bekle.",
    serverFailed: "Sunucu bu isteği tamamlayamadı. Tekrar dene.",
    unexpected: "Beklenmeyen bir şey oldu. Tekrar dene.",
  },

  database: {
    title: "Cihaz veritabanı açılamadı",
    body: "Uygulama yerel kaydını güncelleyemedi. Kayıtlı profillerini kaybetmemek için kendiliğinden onarmıyoruz — uygulamayı silip yeniden kurmak sorunu çözer ama yerel profillerini siler.",
  },

  failure: {
    unconfigured: {
      title: "Sunucu adresi tanımlı değil",
      detail:
        "EXPO_PUBLIC_API_URL ayarlanmamış ve ödünç alınacak bir geliştirme sunucusu da yok.",
    },
    unreachable: {
      title: "Sunucuya ulaşılamıyor",
      detail: "Backend çalışıyor mu ve telefon aynı ağda mı, kontrol et. Sonra tekrar dene.",
    },
    timeout: {
      title: "Cevap zamanında gelmedi",
      detail:
        "Model cihazda çalışıyor ve yavaşlamış olabilir. Tekrar denemek çoğu zaman yeterli.",
    },
    forecast_unavailable: {
      title: "Tahmin alınamadı",
      detail:
        "Sunucu hava tahminine ulaşamadı ve elinde önbelleğe alınmış bir kayıt yok. Birkaç dakika sonra tekrar dene.",
    },
    server: {
      title: "Sunucu hatası",
      detail: "Backend çalışıyor ama isteği tamamlayamadı. Sunucu günlüklerinde ayrıntısı var.",
    },
    request: {
      title: "İstek kabul edilmedi",
      detail: "Uygulama sunucunun beklemediği bir şey gönderdi. Bu bir uygulama hatası.",
    },
    unauthenticated: {
      title: "Oturum açman gerekiyor",
      detail:
        "Bu kısım hesabına bağlı. Sen sekmesinden giriş yap — tahminler ve pencereler hesapsız da çalışmaya devam ediyor.",
    },
    contract: {
      title: "Sunucunun cevabı beklenen biçimde değil",
      detail:
        "İstemci ve sunucu şemaları ayrışmış. packages/schema yeniden üretilmeli, iki taraf da güncellenmeli.",
    },
    unknown: {
      title: "Beklenmeyen bir şey oldu",
      detail: "Ne olduğunu söyleyemiyoruz. Tekrar denemek bir sonuç vermezse günlüklere bak.",
    },
  },
};

/**
 * Typed against `tr`, which is what makes the two halves stay in step.
 *
 * A key added on one side and forgotten on the other does not compile. This is the whole
 * reason for not reaching for a library: `i18next` would have found the same omission at
 * runtime, on a device, in front of someone.
 */
const en: Copy = {
  languageName: "English",

  tabs: { trace: "Trace", ask: "Ask", you: "You" },
  span: { day: "24 hours", week: "7 days" },

  common: {
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    edit: "Edit",
    copy: "Copy",
    loading: "Loading…",
    retry: "Try again",
  },

  weather: {
    clear: "Clear",
    partly: "Partly cloudy",
    overcast: "Overcast",
    fog: "Fog",
    "light-rain": "Light rain",
    freezing: "Freezing rain",
    downpour: "Heavy rain",
    snow: "Snow",
    hail: "Hail",
    storm: "Storm",
  },

  measure: { temperature: "Temperature", wind: "Wind", precipitation: "Rain" },

  activities: { running: "Running", cycling: "Cycling", picnic: "Picnic" },

  constraints: {
    temperature: "Temperature",
    wind: "Wind",
    precipitation: "Rain",
    uv: "UV",
    severe_weather: "Severe weather",
    time_of_day: "Time of day",
  },

  verdict: { good: "Good", mixed: "Mixed", bad: "Not suitable" },

  weekdays: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],
  weekdaysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  months: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  today: "Today",

  age: {
    justNow: "just now",
    minutes: (n: number) => `${n} min ago`,
    hours: (n: number) => `${n} h ago`,
    days: (n: number) => `${n} d ago`,
  },

  card: {
    /** "5 Eylül" in Turkish, "September 5" in English — the order is not translatable. */
    date: (day: number, month: string) => `${day} ${month}`,
    upTo: (deg: number) => `up to ${deg} degrees`,
    openHours: (hours: number, best: string) =>
      `${hours} hours clear, best at ${best}`,
    noOpenHours: "no hours clear",
    noneOpen: "No hours clear",
  },

  trace: {
    fetching: "Fetching the forecast",
    bestWindow: (profile: string) => `The week's best window for ${profile.toLowerCase()}.`,
    stale: (age: string) => `The server is unreachable. This trace is from a forecast ${age}.`,
    nothingClears: "No hour this week clears your limits",
    blocker: (constraint: string, hours: number) =>
      `Your ${constraint.toLowerCase()} limit alone ruled out ${hours} hours.`,
    stalePrefix: "stale · ",
    refresh: "Refresh",
    noResult: (profile: string) => `Nothing matches your ${profile.toLowerCase()} profile.`,
    dayHelp: (profile: string) =>
      `The higher the line, the better that hour is for ${profile.toLowerCase()}. Amber sections are windows that clear your limits.`,
    weekHelp:
      "One card per day. Amber bands are the hours that clear your limits, all on the same 00–24 axis, so an open stretch reads as a column across the week. Tap a card to open that day's trace.",
    precip: (pct: number) => `${pct}% rain`,
  },

  ask: {
    intro: (place: string) =>
      `Ask anything the Trace screen does not already answer. Answers are for ${place}, and the model runs on your own server — nothing you ask goes anywhere else.`,
    examplesLabel: "Try asking",
    examples: [
      "When is the best time to run this week?",
      "Can I run tomorrow morning?",
      "We are thinking of a picnic at the weekend — any good?",
    ],
    placeholder: "Ask something",
    send: "Send",
    longPressHint: "Long press: copy or edit",
    yesterday: "Yesterday",
    kept: (n: number) => `The last ${n} questions are kept on this phone.`,
    close: "Close",
    sendLabel: "Ask",
    saveAndAsk: "Save and ask again",
    fromEngine: "The assistant could not answer; this came from the scoring engine.",
    phases: {
      gathering: "Fetching the weather",
      composing: "Writing the answer",
      repairing: "The answer did not pass its checks, rewriting",
    },
    provenance: {
      noTools: "no tools",
      tools: (n: number) => `${n} tool${n === 1 ? "" : "s"}`,
      onDevice: "on device",
      fromEngine: "from the engine",
      seconds: (ms: number) => `${(ms / 1000).toFixed(1)} s`,
    },
    readings: {
      windValue: (kmh: number) => `${kmh} km/h`,
      precipNone: "none",
      precipValue: (pct: number) => `${pct}%`,
      degrees: (low: number, high: number) =>
        low === high ? `${low}°` : `${low}–${high}°`,
    },
  },

  places: {
    none: (place: string) =>
      `You have no saved places. The app is using ${place} for now; add your own here and it will switch.`,
    useMine: "Use my location",
    locating: "Locating…",
    mine: "here",
    refused:
      "Location permission was refused. You can search for your place below — the rest of the app works exactly the same.",
    add: "Add a place",
    searchPlaceholder: "City or district",
    searchFailed: "Place search is not working. Check that the server is reachable.",
    here: "My location",
  },

  you: {
    settings: "Settings",
    title: "You",
    account: "Account",
    guestLabel: "You are a guest",
    pending: "Notifications and assistant status will appear here.",
    language: "Language",
    languageHelp:
      "The interface and the assistant's answers use this language. It is sent to the assistant too, so the language of a reply is never guessed.",
    signedIn:
      "Your profiles and places are saved to this account. They survive deleting and reinstalling the app.",
    signOut: "Sign out",
    signingOut: "Signing out…",
    unmovedLabel: "Profiles not yet moved",
    unmoved: (n: number) =>
      `There ${n === 1 ? "is" : "are"} ${n} profile${n === 1 ? "" : "s"} on this phone that are not attached to your account. Move them and they open on any device.`,
    moveToAccount: "Move to my account",
    moving: "Moving…",
    guest:
      "Everything works and nothing leaves your device. Your profiles are stored on this phone. Create an account and they are saved to your server, and open on a second device.",
    signInOrUp: "Create an account or sign in",
    places: "Places",
  },

  profiles: {
    label: "Profiles",
    newProfile: "New profile",
    newProfileName: "New profile",
    saving: "Saving…",
    failed: "Profiles could not be loaded. Open the You tab again.",
    none: "You have no saved profiles. Trace is using the three built-in ones; save your own here and the chips come from it.",
    saveBuiltIns: "Save the built-in three",
    tempMin: "Lowest temperature",
    tempMax: "Highest temperature",
    windMax: "Wind limit",
    precipMax: "Chance of rain",
    hoursFrom: "Hours you prefer — from",
    hoursTo: "Hours you prefer — to",
    inverted: "The lowest temperature cannot be above the highest.",
    increase: (label: string) => `Increase ${label.toLowerCase()}`,
    decrease: (label: string) => `Decrease ${label.toLowerCase()}`,
    windUnit: "km/h",
  },

  tour: {
    skip: "Skip",
    next: "Next",
    start: "Start",
    again: "Show the tour again",
    step: (at: number, of: number) => `Step ${at} of ${of}`,
    pages: [
      {
        title: "When?",
        body: "You already know the temperature. This tells you when to go out — for a run, a walk, a picnic. The high parts are how well an hour suits you; they are not degrees.",
      },
      {
        title: "Your limits",
        body: "How warm is too warm? How much wind? At what chance of rain do you stay in? Say it once and it does the arithmetic. The amber hours are the ones that clear it.",
      },
      {
        title: "Just ask",
        body: "\u201cIs the weekend any good for a picnic?\u201d Ask it like that. Nothing you ask ever leaves your phone.",
      },
    ],
  },

  welcome: {
    pitch:
      "It tells you when to go outside, not what the temperature is. The model runs on your own server — nothing you ask goes anywhere else.",
    signUp: "Create an account",
    signIn: "Sign in",
    asGuest: "Carry on without an account",
    guestTitle: "Everything works without an account.",
    guestBody:
      "Your profiles and places stay on this phone; nothing is sent to the server. An account saves them to your server, so they survive a new phone. You can create one later.",

    email: "Email",
    emailPlaceholder: "you@example.com",
    password: "Password",
    passwordPlaceholder: (min: number) => `At least ${min} characters`,
    passwordHint: (min: number) =>
      `At least ${min} characters. Length is what helps; a mix of symbols is not.`,
    back: "Back",
    carryOn: "Carry on",

    onThisDevice: "Profiles on this phone",
    offer: (count: string) =>
      `You made ${count} profiles without an account. Move them across? They will open on any device; leave them and they stay here.`,
    movedTitle: "Moved",
    partlyMovedTitle: "Some moved",
    moved: (n: number) => `${n} profile${n === 1 ? "" : "s"} saved to your account.`,
    failedToMove: (n: number) =>
      ` ${n} could not be sent; they are still on the phone, and you can try again from the You tab.`,
    keepForNow: "Leave them here",

    unreachable:
      "The server could not be reached. Check that the backend is running and that you are on the same network.",
    wrongCredentials: "That email or password is wrong.",
    accountExists: "There is already an account at this address. Try signing in.",
    invalid: (min: number) =>
      `The address must be a valid email, and the password at least ${min} characters.`,
    refused: "Those details were not accepted.",
    tooMany: "Too many attempts. Wait a few minutes.",
    serverFailed: "The server could not complete this request. Try again.",
    unexpected: "Something unexpected happened. Try again.",
  },

  database: {
    title: "The device database would not open",
    body: "The app could not migrate its local store. We do not repair it automatically, because that would lose your saved profiles — deleting and reinstalling the app fixes it, and deletes your local profiles with it.",
  },

  failure: {
    unconfigured: {
      title: "No server address is configured",
      detail: "EXPO_PUBLIC_API_URL is not set, and there is no development server to borrow.",
    },
    unreachable: {
      title: "The server is unreachable",
      detail:
        "Check that the backend is running and the phone is on the same network. Then try again.",
    },
    timeout: {
      title: "The answer did not arrive in time",
      detail: "The model runs on device and may have slowed down. Trying again is usually enough.",
    },
    forecast_unavailable: {
      title: "The forecast could not be fetched",
      detail:
        "The server could not reach the weather service and has nothing cached. Try again in a few minutes.",
    },
    server: {
      title: "Server error",
      detail: "The backend is running but could not complete the request. The server logs have the detail.",
    },
    request: {
      title: "The request was refused",
      detail: "The app sent something the server did not expect. This is a bug in the app.",
    },
    unauthenticated: {
      title: "You need to sign in",
      detail:
        "This part is tied to your account. Sign in from the You tab — forecasts and windows keep working without one.",
    },
    contract: {
      title: "The server's reply is not the expected shape",
      detail:
        "The client and server schemas have drifted. Regenerate packages/schema and update both sides.",
    },
    unknown: {
      title: "Something unexpected happened",
      detail: "We cannot say what. If trying again does not help, check the logs.",
    },
  },
};

export type Copy = typeof tr;

const COPY: Record<Language, Copy> = { tr, en };

/** The copy for a language, for the plain functions that are not components. */
export function copyFor(language: Language): Copy {
  return COPY[language];
}
