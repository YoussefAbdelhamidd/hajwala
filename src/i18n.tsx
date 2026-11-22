import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export type Locale = 'ar' | 'en'

const LANG_KEY = 'tafheet-lang'

const messages = {
  ar: {
    'meta.title': 'تفحيط — أمسك الصينية',
    'meta.description': 'لعبة تفحيط HTML5 على طريق الرياض. أمسك الصينية، اربط الانزلاقات، ووصّل الطلب للبيت.',
    'brand.name': 'تفحيط',
    'brand.tag': 'أمسك الصينية',
    'brand.home': 'تفحيط — الصفحة الرئيسية',
    'boot.eyebrow': 'تفحيط · الرياض',
    'boot.title.hold': 'أمسك',
    'boot.title.tray': 'الصينية.',
    'boot.warming': 'نسخّن الطريق السريع…',
    'boot.tray': 'نجهّز الصينية…',
    'boot.car': 'نركن السيارة…',
    'boot.towers': 'نرفع الأبراج…',
    'boot.chicken': 'نستدعي الدجاجة…',
    'boot.kitchen': 'نفتح المطبخ…',
    'boot.table': 'نرتّب الطاولة…',
    'boot.road': 'نضيء الطريق…',
    'boot.almost': 'تقريباً جاهز…',
    'boot.asphalt': 'نطلع على الأسفلت…',
    'boot.ready': 'جاهز.',
    'loc.riyadhDrift': 'الرياض · درفت',
    'nav.leaderboard': 'المتصدرون المحليون',
    'nav.garage': 'الكراج',
    'nav.howto': 'طريقة اللعب',
    'nav.resume': 'متابعة',
    'nav.pause': 'إيقاف',
    'nav.lang': 'اللغة',
    'coach.skip': 'تخطي',
    'garage.open': 'الكراج · غيّر السيارة',
    'garage.cta': 'الكراج',
    'garage.ctaHint': 'غيّر سيارتك',
    'garage.eyebrow': 'تفحيط · الكراج',
    'garage.title': 'اختر سيارتك.',
    'garage.blurb': 'أحسن سيارة = أعلى رقم شخصي مطلوب. سجّل أفضل نتيجة لفتح الجديد.',
    'garage.select': 'اختيار',
    'garage.preview': 'معاينة',
    'garage.selected': 'مختارة',
    'garage.use': 'استخدم السيارة',
    'garage.locked': 'مقفل · أفضل {score}',
    'garage.back': 'رجوع',
    'garage.devAll': 'وضع التطوير · كل السيارات مفتوحة',
    'car.tuktuk.name': 'توك توك',
    'car.tray.name': 'صيّاد الصينية',
    'car.coupe_spirit.name': 'كوبيه الروح',
    'car.street_racer.name': 'درّاب الشارع',
    'car.night_spec.name': 'مواصفات الليل',
    'car.neon_runner.name': 'عدّاء النيون',
    'car.gt_wedge.name': 'الإسفين GT',
    'car.classic_wedge.name': 'الإسفين الكلاسيكي',
    'topline.left': 'جولة بلا نهاية · طريق الصينية',
    'topline.right': 'على الخط · الرياض',
    'intro.eyebrow': 'تفحيط · الرياض',
    'intro.body': 'درّف. اجمع نقاط. لا تصطدم.',
    'intro.start': 'ابدأ',
    'intro.noteDesktop': 'W/Z بنزين · A/Q و D توجيه · Space درفت',
    'intro.noteMobile': 'دواسات يمين · توجيه يسار',
    'coach.desktop': 'W/Z بنزين · A/Q و D لف · Space درفت · ابقَ على الأسفلت',
    'coach.mobile': 'بنزين يمين · لف يسار · فرامل اليد للدرفت · ابقَ على الأسفلت',
    'hud.score': 'نقاط الجولة',
    'hud.best': 'أفضل رقم',
    'hud.distance': 'المسافة',
    'hud.km': 'كم',
    'hud.longest': 'أطول سلسلة',
    'hud.keepSideways': 'خلّها جانبية',
    'hud.linkNext': 'اربط الانزلاقة التالية',
    'hud.drifting': 'درفت',
    'hud.chainLive': 'السلسلة حيّة',
    'hud.offroad': 'خارج الطريق · انتهت الجولة',
    'meta.fromKitchen': 'من المطبخ',
    'meta.oneTray': 'صينية واحدة. الطريق كله.',
    'speed.car': 'السيارة',
    'speed.unit': 'كم/س',
    'speed.gear': 'ناقل',
    'speed.lostGrip': '● فقدت التماسك',
    'speed.ready': '● جاهز للانزلاق',
    'controls.pedals': 'دواسة / فرامل',
    'controls.steer': 'توجيه',
    'controls.handbrake': 'فرامل يد',
    'controls.pause': 'إيقاف',
    'touch.wheel': 'عجلة القيادة',
    'touch.steer': 'توجيه',
    'touch.left': 'يسار',
    'touch.right': 'يمين',
    'touch.straight': 'مستقيم',
    'touch.leftPct': 'يسار {n}٪',
    'touch.rightPct': 'يمين {n}٪',
    'touch.gyroUnsupported': 'الجهاز ما يدعم الجيروسكوب',
    'touch.gyroEnabling': 'جاري التفعيل…',
    'touch.gyroEnable': 'فعّل الجيروسكوب',
    'touch.gyroLabel': 'توجيه بالجيرو',
    'touch.calibrate': 'عاير',
    'touch.calibrateAria': 'معايرة الجيروسكوب',
    'touch.tiltHint': 'ميل الجهاز',
    'touch.handbrake': 'فرامل اليد',
    'touch.brake': 'فرامل',
    'touch.gas': 'بنزين',
    'steer.label': 'التوجيه',
    'steer.group': 'طريقة التوجيه',
    'steer.wheel': 'عجلة',
    'steer.buttons': 'أزرار',
    'steer.gyro': 'جيرو',
    'howto.eyebrow': 'القواعد',
    'howto.title': 'كيف تلعب',
    'howto.desktop1': 'W/Z بنزين · S فرامل · A/Q و D توجيه · Space درفت',
    'howto.desktop2': 'لف + Space، بعدين وجّه عكس عشان تمسك الدرفت.',
    'howto.desktop3': 'ابقَ على الأسفلت. الاصطدام أو الخروج = نهاية.',
    'howto.desktop4': 'P للإيقاف المؤقت.',
    'howto.mobile1': 'دواسات وفرامل اليد يمين. التوجيه يسار (عجلة / أزرار / جيرو).',
    'howto.mobile2': 'بنزين + لف + فرامل يد للدرفت، بعدين لف عكس.',
    'howto.mobile3': 'ابقَ على الأسفلت. الاصطدام أو الخروج = نهاية.',
    'howto.ok': 'تمام',
    'modal.eyebrow': 'تفحيط · جولة الصينية',
    'modal.helpTitle': 'لاقِ زاويتك.',
    'modal.finishTitle': 'الصينية لسه سخنة.',
    'modal.pauseTitle': 'الدجاجة تقدر تستنى.',
    'modal.help1': 'W/Z بنزين، A/Q و D توجيه، Space للدرفت وأنت تلف، بعدين وجّه عكس عشان تمسكه.',
    'modal.help2': 'اربط الدرفت خلال {chain}ث (كل × ≈ {tier}ث). التجاوزات والدجاجات بونص. الأسفلت أو الاصطدام = نهاية.',
    'modal.helpTouch': 'لمس: عجلة / أزرار / جيرو، الدواسات يمين.',
    'modal.ok': 'تمام',
    'modal.finishBody': 'سجّلت {score} نقطة على مسافة {km} كم.\nأطول سلسلة: ×{combo} · تجاوزات قريبة: {near}\nأفضل رقم: {best}',
    'modal.again': 'جولة ثانية',
    'modal.showBoard': 'عرض المتصدرين المحليين',
    'modal.menu': 'القائمة الرئيسية',
    'modal.pauseBody': 'المطبخ يقدر يستنى.',
    'modal.continue': 'كمّل سواقة',
    'modal.restart': 'أعد الجولة',
    'board.eyebrow': 'تفحيط · أفضل ١٠ / هذا الجهاز',
    'board.title': 'سجّل علامتك.',
    'board.blurb': 'الجولات المكتملة مرتبة بالنقاط. التعادل يروح للأطول مسافة.',
    'board.empty': 'ما فيه جولات مكتملة بعد. جولتك الأولى تحدد العلامة.',
    'board.headScore': 'النقاط / التاريخ',
    'board.headKm': 'كم',
    'board.headCombo': 'سلسلة',
    'board.back': 'رجوع',
    'event.offroad': 'خارج الطريق · انتهت الجولة',
    'event.chainBroken': 'انقطعت السلسلة · ابدأ درفت جديد',
    'event.trafficCrash': 'اصطدام بالمرور · انتهت الجولة',
    'event.linkedDrift': 'درفت مربوط +{n}',
    'event.nearMiss': 'تجاوز قريب +{n}',
    'event.sidePass': 'تجاوز جانبي +{n}',
    'event.chicken': 'ضرب الدجاجة +{n}',
  },
  en: {
    'meta.title': 'Tafheet — Hold the Tray',
    'meta.description': 'HTML5 drifting on the Riyadh highway. Hold the tray, link your slides, and get the order home.',
    'brand.name': 'Tafheet',
    'brand.tag': 'Hold the tray',
    'brand.home': 'Tafheet — home',
    'boot.eyebrow': 'Tafheet · Riyadh',
    'boot.title.hold': 'Hold',
    'boot.title.tray': 'the tray.',
    'boot.warming': 'Warming up the highway…',
    'boot.tray': 'Prepping the tray…',
    'boot.car': 'Parking the car…',
    'boot.towers': 'Raising the towers…',
    'boot.chicken': 'Calling the chicken…',
    'boot.kitchen': 'Opening the kitchen…',
    'boot.table': 'Setting the table…',
    'boot.road': 'Lighting the road…',
    'boot.almost': 'Almost ready…',
    'boot.asphalt': 'Hitting the asphalt…',
    'boot.ready': 'Ready.',
    'loc.riyadhDrift': 'Riyadh · Drift',
    'nav.leaderboard': 'Local leaderboard',
    'nav.garage': 'Garage',
    'nav.howto': 'How to play',
    'nav.resume': 'Resume',
    'nav.pause': 'Pause',
    'nav.lang': 'Language',
    'coach.skip': 'Skip',
    'garage.open': 'Garage · change car',
    'garage.cta': 'Garage',
    'garage.ctaHint': 'Change your car',
    'garage.eyebrow': 'Tafheet · Garage',
    'garage.title': 'Pick your ride.',
    'garage.blurb': 'Better cars need a higher personal best. Beat your mark to unlock the next one.',
    'garage.select': 'Select',
    'garage.preview': 'Preview',
    'garage.selected': 'Selected',
    'garage.use': 'Use this car',
    'garage.locked': 'Locked · best {score}',
    'garage.back': 'Back',
    'garage.devAll': 'Dev mode · all cars unlocked',
    'car.tuktuk.name': 'Tuk-tuk',
    'car.tray.name': 'Tray runner',
    'car.coupe_spirit.name': 'Spirit Coupe',
    'car.street_racer.name': 'Street Racer',
    'car.night_spec.name': 'Night Spec',
    'car.neon_runner.name': 'Neon Runner',
    'car.gt_wedge.name': 'GT Wedge',
    'car.classic_wedge.name': 'Classic Wedge',
    'topline.left': 'Endless run · Tray highway',
    'topline.right': 'Live · Riyadh',
    'intro.eyebrow': 'Tafheet · Riyadh',
    'intro.body': 'Drift. Score. Don’t crash.',
    'intro.start': 'START',
    'intro.noteDesktop': 'W/Z gas · A/Q + D steer · Space drift',
    'intro.noteMobile': 'Pedals right · steer left',
    'coach.desktop': 'W/Z gas · A/Q + D steer · Space drift · stay on asphalt',
    'coach.mobile': 'Gas right · steer left · handbrake to drift · stay on asphalt',
    'hud.score': 'Run score',
    'hud.best': 'Best',
    'hud.distance': 'Distance',
    'hud.km': 'km',
    'hud.longest': 'Longest chain',
    'hud.keepSideways': 'Keep it sideways',
    'hud.linkNext': 'Link the next slide',
    'hud.drifting': 'Drift',
    'hud.chainLive': 'Chain live',
    'hud.offroad': 'Off road · run over',
    'meta.fromKitchen': 'From the kitchen',
    'meta.oneTray': 'One tray. The whole road.',
    'speed.car': 'Car',
    'speed.unit': 'km/h',
    'speed.gear': 'Gear',
    'speed.lostGrip': '● Lost traction',
    'speed.ready': '● Ready to slide',
    'controls.pedals': 'Throttle / brake',
    'controls.steer': 'Steer',
    'controls.handbrake': 'Handbrake',
    'controls.pause': 'Pause',
    'touch.wheel': 'Steering wheel',
    'touch.steer': 'Steering',
    'touch.left': 'Left',
    'touch.right': 'Right',
    'touch.straight': 'Straight',
    'touch.leftPct': 'Left {n}%',
    'touch.rightPct': 'Right {n}%',
    'touch.gyroUnsupported': 'This device has no gyroscope',
    'touch.gyroEnabling': 'Enabling…',
    'touch.gyroEnable': 'Enable gyro',
    'touch.gyroLabel': 'Gyro steering',
    'touch.calibrate': 'Cal',
    'touch.calibrateAria': 'Calibrate gyroscope',
    'touch.tiltHint': 'Tilt device',
    'touch.handbrake': 'Handbrake',
    'touch.brake': 'Brake',
    'touch.gas': 'Gas',
    'steer.label': 'Steering',
    'steer.group': 'Steering mode',
    'steer.wheel': 'Wheel',
    'steer.buttons': 'Buttons',
    'steer.gyro': 'Gyro',
    'howto.eyebrow': 'Rules',
    'howto.title': 'How to play',
    'howto.desktop1': 'W/Z gas · S brake · A/Q + D steer · Space drift',
    'howto.desktop2': 'Turn + Space, then counter-steer to hold the drift.',
    'howto.desktop3': 'Stay on asphalt. Crash or leave the road = run over.',
    'howto.desktop4': 'P to pause.',
    'howto.mobile1': 'Pedals + handbrake on the right. Steer on the left (wheel / buttons / gyro).',
    'howto.mobile2': 'Gas + turn + handbrake to drift, then counter-steer.',
    'howto.mobile3': 'Stay on asphalt. Crash or leave the road = run over.',
    'howto.ok': 'Got it',
    'modal.eyebrow': 'Tafheet · Tray run',
    'modal.helpTitle': 'Find your angle.',
    'modal.finishTitle': 'Tray’s still hot.',
    'modal.pauseTitle': 'The chicken can wait.',
    'modal.help1': 'W/Z gas, A/Q + D steer, Space while turning to drift, then counter-steer to catch it.',
    'modal.help2': 'Link drifts within {chain}s (each × ≈ {tier}s). Near misses and chickens bonus. Leave asphalt or hit traffic = run over.',
    'modal.helpTouch': 'Touch: wheel / buttons / gyro; pedals on the right.',
    'modal.ok': 'Got it',
    'modal.finishBody': 'You scored {score} points over {km} km.\nLongest chain: ×{combo} · Near misses: {near}\nBest: {best}',
    'modal.again': 'Another run',
    'modal.showBoard': 'Show local leaderboard',
    'modal.menu': 'Main menu',
    'modal.pauseBody': 'The kitchen can wait.',
    'modal.continue': 'Keep driving',
    'modal.restart': 'Restart run',
    'board.eyebrow': 'Tafheet · Top 10 / this device',
    'board.title': 'Set the mark.',
    'board.blurb': 'Finished runs ranked by score. Ties go to longer distance.',
    'board.empty': 'No finished runs yet. Your first run sets the mark.',
    'board.headScore': 'Score / date',
    'board.headKm': 'km',
    'board.headCombo': 'Chain',
    'board.back': 'Back',
    'event.offroad': 'Off road · run over',
    'event.chainBroken': 'Chain broken · start a new drift',
    'event.trafficCrash': 'Traffic crash · run over',
    'event.linkedDrift': 'Linked drift +{n}',
    'event.nearMiss': 'Near miss +{n}',
    'event.sidePass': 'Side pass +{n}',
    'event.chicken': 'Chicken hit +{n}',
  },
} as const

export type MessageKey = keyof typeof messages.ar

type Vars = Record<string, string | number>

function fill(template: string, vars?: Vars) {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''))
}

/** Map CrazyGames / BCP-47 locale strings onto our two language packs. */
export function localeFromSdk(raw: string | null | undefined): Locale | null {
  if (!raw) return null
  const code = raw.trim().toLowerCase().replace('_', '-')
  if (code === 'ar' || code.startsWith('ar-')) return 'ar'
  if (code === 'en' || code.startsWith('en-')) return 'en'
  return null
}

/**
 * Prefer an explicit user choice, else CrazyGames `systemInfo.locale`, else English.
 * Arabic remains available via the language chip when the portal is not Arabic.
 */
export function detectLocale(sdkLocale?: string | null): Locale {
  try {
    const stored = localStorage.getItem(LANG_KEY)
    if (stored === 'en' || stored === 'ar') return stored
  } catch { /* ignore */ }
  return localeFromSdk(sdkLocale) ?? 'en'
}

export function applyDocumentLocale(locale: Locale) {
  const root = document.documentElement
  root.lang = locale
  root.dir = locale === 'ar' ? 'rtl' : 'ltr'
  document.title = messages[locale]['meta.title']
  const meta = document.querySelector('meta[name="description"]')
  if (meta) meta.setAttribute('content', messages[locale]['meta.description'])
}

export function translate(locale: Locale, key: MessageKey, vars?: Vars) {
  return fill(messages[locale][key] ?? messages.ar[key] ?? key, vars)
}

/** Map gameplay event codes to localized copy. */
export function formatRunEvent(locale: Locale, event: string) {
  if (!event) return ''
  const split = event.indexOf(':')
  const code = split === -1 ? event : event.slice(0, split)
  const n = split === -1 ? undefined : event.slice(split + 1)
  const map: Record<string, MessageKey> = {
    offroad: 'event.offroad',
    chain_broken: 'event.chainBroken',
    traffic_crash: 'event.trafficCrash',
    linked_drift: 'event.linkedDrift',
    near_miss: 'event.nearMiss',
    side_pass: 'event.sidePass',
    chicken: 'event.chicken',
  }
  const key = map[code]
  if (!key) return event
  return translate(locale, key, n != null ? { n } : undefined)
}

type I18nValue = {
  locale: Locale
  dir: 'rtl' | 'ltr'
  setLocale: (locale: Locale) => void
  syncCrazyLocale: (sdkLocale: string | null | undefined) => void
  t: (key: MessageKey, vars?: Vars) => string
  formatEvent: (event: string) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = detectLocale()
    if (typeof document !== 'undefined') applyDocumentLocale(initial)
    return initial
  })
  const userPicked = useRef(false)

  const setLocale = useCallback((next: Locale) => {
    userPicked.current = true
    setLocaleState(next)
    applyDocumentLocale(next)
    try { localStorage.setItem(LANG_KEY, next) } catch { /* session still works */ }
  }, [])

  /** Apply portal language once after SDK init — never overrides an explicit chip choice. */
  const syncCrazyLocale = useCallback((sdkLocale: string | null | undefined) => {
    if (userPicked.current) return
    try {
      const stored = localStorage.getItem(LANG_KEY)
      if (stored === 'en' || stored === 'ar') return
    } catch { /* ignore */ }
    const next = localeFromSdk(sdkLocale)
    if (!next) return
    setLocaleState(prev => {
      if (prev === next) return prev
      applyDocumentLocale(next)
      return next
    })
  }, [])

  const value = useMemo<I18nValue>(() => ({
    locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    setLocale,
    syncCrazyLocale,
    t: (key, vars) => translate(locale, key, vars),
    formatEvent: event => formatRunEvent(locale, event),
  }), [locale, setLocale, syncCrazyLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n requires LocaleProvider')
  return ctx
}
