// ============================================================
//  مساعد العيادة — WhatsApp Booking Bot
//  Stack : Node.js + Express + Twilio WhatsApp
//  Deploy: Railway.app (free) | Render.com (free)
// ============================================================

const express = require('express');
const { twiml: { MessagingResponse } } = require('twilio');

const app  = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Clinic config (edit to match real clinic) ───────────────
const CLINIC = {
  nameAr: 'عيادة الإمارات للأسنان والليزر',
  nameEn: 'Emirates Dental & Laser Clinic',
};

// ─── Services ────────────────────────────────────────────────
const SERVICES = {
  '1': { ar: 'تنظيف الأسنان',     en: 'Teeth Cleaning',        price: '١٥٠ درهم', priceEn: 'AED 150', duration: '٤٥ دقيقة' },
  '2': { ar: 'تبييض الأسنان',     en: 'Teeth Whitening',       price: '٣٥٠ درهم', priceEn: 'AED 350', duration: 'ساعة'     },
  '3': { ar: 'ليزر إزالة الشعر',  en: 'Laser Hair Removal',    price: '٣٠٠ درهم', priceEn: 'AED 300', duration: 'ساعة'     },
  '4': { ar: 'تقويم الأسنان',     en: 'Dental Braces Consult', price: '١٠٠ درهم', priceEn: 'AED 100', duration: '٣٠ دقيقة' },
};

// ─── Time slots (update daily or connect to Google Calendar) ─
const SLOTS = [
  { id: '1', ar: 'الأحد   — ١٠:٠٠ صباحاً',   en: 'Sunday   — 10:00 AM' },
  { id: '2', ar: 'الأحد   — ٣:٠٠  مساءً',    en: 'Sunday   — 3:00 PM'  },
  { id: '3', ar: 'الاثنين — ١١:٠٠ صباحاً',   en: 'Monday   — 11:00 AM' },
  { id: '4', ar: 'الثلاثاء — ٢:٠٠ ظهراً',    en: 'Tuesday  — 2:00 PM'  },
  { id: '5', ar: 'الأربعاء — ٤:٠٠ مساءً',    en: 'Wednesday — 4:00 PM' },
];

// ─── In-memory sessions (demo) ──────────────────────────────
// For production: replace with Redis or a simple SQLite DB
const sessions = new Map();

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, { state: 'WELCOME', lang: 'ar', data: {}, visits: 0 });
  }
  return sessions.get(phone);
}

// ─── Language helpers ────────────────────────────────────────
function isArabic(text) {
  return /[؀-ۿ]/.test(text);
}

function detectLang(text) {
  return isArabic(text) ? 'ar' : 'en';
}

// ─── Message templates ───────────────────────────────────────
const MSG = {
  welcome: {
    ar: (clinic) => `أهلاً وسهلاً! 👋\nأنا المساعد الآلي لـ *${clinic}*.\n\nكيف أقدر أساعدك اليوم؟\n\n1️⃣ حجز موعد جديد\n2️⃣ استفسار عن الخدمات\n3️⃣ أوقات الدوام`,
    en: (clinic) => `Welcome! 👋\nI'm the automated assistant for *${clinic}*.\n\nHow can I help you today?\n\n1️⃣ Book a new appointment\n2️⃣ Service inquiry\n3️⃣ Working hours`,
  },
  welcomeBack: {
    ar: (name, lastService) => `أهلاً بك مرة ثانية يا *${name}*! 😊\nزيارتك الأخيرة كانت لـ *${lastService}*.\n\nتبي تحجز نفس الخدمة؟\n\n1️⃣ نعم، نفس الخدمة\n2️⃣ لا، خدمة ثانية`,
    en: (name, lastService) => `Welcome back, *${name}*! 😊\nYour last visit was for *${lastService}*.\n\nWould you like to book the same service?\n\n1️⃣ Yes, same service\n2️⃣ No, different service`,
  },
  selectService: {
    ar: () => `ممتاز! 😊 شو الخدمة اللي تبيها؟\n\n1️⃣ تنظيف الأسنان       — ١٥٠ درهم\n2️⃣ تبييض الأسنان       — ٣٥٠ درهم\n3️⃣ ليزر إزالة الشعر   — ٣٠٠ درهم\n4️⃣ استشارة تقويم       — ١٠٠ درهم`,
    en: () => `Great! 😊 Which service would you like?\n\n1️⃣ Teeth Cleaning        — AED 150\n2️⃣ Teeth Whitening       — AED 350\n3️⃣ Laser Hair Removal    — AED 300\n4️⃣ Braces Consultation   — AED 100`,
  },
  selectTime: {
    ar: (svc) => `${svc.ar} ✅\nالمدة: ${svc.duration} | السعر: ${svc.price}\n\nاختر الوقت المناسب:\n\n${SLOTS.map(s => `${s.id}️⃣ ${s.ar}`).join('\n')}`,
    en: (svc) => `${svc.en} ✅\nDuration: ${svc.duration} | Price: ${svc.priceEn}\n\nChoose a time slot:\n\n${SLOTS.map(s => `${s.id}️⃣ ${s.en}`).join('\n')}`,
  },
  askName: {
    ar: () => `تمام! آخر خطوة 😊\nما اسمك الكريم؟`,
    en: () => `Almost done! 😊\nWhat's your name?`,
  },
  confirmed: {
    ar: (d) => `✅ *تم تأكيد حجزك!*\n\n👤 الاسم:    ${d.name}\n💆 الخدمة:  ${d.service.ar}\n📅 الموعد:  ${d.slot.ar}\n💰 السعر:   ${d.service.price}\n\nسنرسل لك تذكيراً قبل الموعد بيوم ⏰\n\nشكراً يا ${d.name}، نتطلع لاستقبالك! 😊`,
    en: (d) => `✅ *Booking Confirmed!*\n\n👤 Name:     ${d.name}\n💆 Service:  ${d.service.en}\n📅 Slot:     ${d.slot.en}\n💰 Price:    ${d.service.priceEn}\n\nWe'll send you a reminder the day before ⏰\n\nThank you, ${d.name}! We look forward to seeing you 😊`,
  },
  hours: {
    ar: () => `⏰ *أوقات الدوام:*\n\nالأحد – الخميس:  ٩ ص – ٩ م\nالجمعة:            ٢ ظ – ٩ م\nالسبت:             ١٠ ص – ٦ م\n\nنقبل الحجز عبر واتساب ٢٤/٧ 😊`,
    en: () => `⏰ *Working Hours:*\n\nSun – Thu:  9 AM – 9 PM\nFriday:      2 PM – 9 PM\nSaturday:   10 AM – 6 PM\n\nBooking accepted via WhatsApp 24/7 😊`,
  },
  services: {
    ar: () => `خدماتنا:\n\n🦷 تنظيف الأسنان     — ١٥٠ درهم (٤٥ دقيقة)\n✨ تبييض الأسنان     — ٣٥٠ درهم (ساعة)\n💆 ليزر إزالة الشعر — ٣٠٠ درهم (ساعة)\n📋 استشارة تقويم    — ١٠٠ درهم (٣٠ دقيقة)\n\nللحجز ارسل *1*`,
    en: () => `Our services:\n\n🦷 Teeth Cleaning       — AED 150 (45 min)\n✨ Teeth Whitening      — AED 350 (1 hr)\n💆 Laser Hair Removal  — AED 300 (1 hr)\n📋 Braces Consult      — AED 100 (30 min)\n\nTo book, reply *1*`,
  },
  invalid: {
    ar: (opts) => `ارسل رقم من الخيارات:\n${opts}`,
    en: (opts) => `Please reply with a number from the options:\n${opts}`,
  },
  missedCall: {
    ar: (clinic) => `مرحبا! 👋\nلاحظنا إنك حاولت تتصل بـ *${clinic}*.\nنأسف — كنا مشغولين في تلك اللحظة 🙏\n\nأقدر أساعدك الحين عبر واتساب!\n\n1️⃣ حجز موعد\n2️⃣ استفسار`,
    en: (clinic) => `Hi! 👋\nWe noticed you tried to call *${clinic}*.\nWe're sorry we missed you 🙏\n\nI can help you right now via WhatsApp!\n\n1️⃣ Book an appointment\n2️⃣ Ask a question`,
  },
};

// ─── State machine ───────────────────────────────────────────
function processMessage(phone, body) {
  const session = getSession(phone);
  const msg     = body.trim();
  const lang    = detectLang(msg) || session.lang;
  session.lang  = lang;
  const L       = (obj, ...args) => (obj[lang] || obj['ar'])(...args);
  let reply     = '';

  switch (session.state) {

    // ── First contact ──────────────────────────────────────
    case 'WELCOME':
      session.visits += 1;
      if (session.visits > 1 && session.data.name) {
        reply = L(MSG.welcomeBack, session.data.name, session.data.lastService || '');
        session.state = 'RETURNING_MENU';
      } else {
        reply = L(MSG.welcome, lang === 'ar' ? CLINIC.nameAr : CLINIC.nameEn);
        session.state = 'MAIN_MENU';
      }
      break;

    // ── Main menu ──────────────────────────────────────────
    case 'MAIN_MENU':
      if (msg === '1' || /حجز|book/i.test(msg)) {
        reply = L(MSG.selectService);
        session.state = 'SELECT_SERVICE';
      } else if (msg === '2' || /خدم|استفسار|service|inquiry/i.test(msg)) {
        reply = L(MSG.services);
      } else if (msg === '3' || /وقت|دوام|hour|time/i.test(msg)) {
        reply = L(MSG.hours);
      } else {
        reply = L(MSG.welcome, lang === 'ar' ? CLINIC.nameAr : CLINIC.nameEn);
      }
      break;

    // ── Returning client ───────────────────────────────────
    case 'RETURNING_MENU':
      if (msg === '1' || /نعم|yes|إي/i.test(msg)) {
        // Reuse last service
        const lastSvcKey = session.data.lastServiceKey;
        const svc = SERVICES[lastSvcKey];
        if (svc) {
          session.data.service = svc;
          reply = L(MSG.selectTime, svc);
          session.state = 'SELECT_TIME';
        } else {
          reply = L(MSG.selectService);
          session.state = 'SELECT_SERVICE';
        }
      } else {
        reply = L(MSG.selectService);
        session.state = 'SELECT_SERVICE';
      }
      break;

    // ── Choose service ─────────────────────────────────────
    case 'SELECT_SERVICE':
      if (SERVICES[msg]) {
        const svc = SERVICES[msg];
        session.data.service    = svc;
        session.data.lastServiceKey = msg;
        session.data.lastService = svc.ar;
        reply = L(MSG.selectTime, svc);
        session.state = 'SELECT_TIME';
      } else {
        reply = L(MSG.invalid, L(MSG.selectService).split('\n').slice(1).join('\n'));
      }
      break;

    // ── Choose time slot ───────────────────────────────────
    case 'SELECT_TIME':
      const slot = SLOTS.find(s => s.id === msg);
      if (slot) {
        session.data.slot = slot;
        reply = L(MSG.askName);
        session.state = 'GET_NAME';
      } else {
        reply = L(MSG.invalid, SLOTS.map(s => `${s.id}️⃣ ${lang === 'ar' ? s.ar : s.en}`).join('\n'));
      }
      break;

    // ── Get name ───────────────────────────────────────────
    case 'GET_NAME':
      if (msg.length < 2) {
        reply = lang === 'ar' ? 'الرجاء إدخال اسمك الكريم' : 'Please enter your name';
        break;
      }
      session.data.name = msg;
      reply = L(MSG.confirmed, session.data);
      session.state = 'DONE';
      // Auto-reset session after 10 minutes so they can book again
      setTimeout(() => {
        const s = sessions.get(phone);
        if (s) { s.state = 'WELCOME'; }
      }, 600000);
      break;

    // ── After booking ──────────────────────────────────────
    case 'DONE':
      // Treat any new message as starting fresh
      session.state = 'MAIN_MENU';
      reply = L(MSG.welcome, lang === 'ar' ? CLINIC.nameAr : CLINIC.nameEn);
      break;

    default:
      session.state = 'WELCOME';
      reply = L(MSG.welcome, lang === 'ar' ? CLINIC.nameAr : CLINIC.nameEn);
  }

  return reply;
}

// ─── Twilio webhook endpoint ─────────────────────────────────
app.post('/whatsapp', (req, res) => {
  const body  = req.body.Body || '';
  const from  = req.body.From || 'unknown';

  console.log(`[${new Date().toISOString()}] FROM: ${from} | MSG: ${body}`);

  const replyText = processMessage(from, body);
  const twiml     = new MessagingResponse();
  twiml.message(replyText);

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

// ─── Missed-call trigger (called from your phone system) ─────
// POST /missed-call  { "to": "whatsapp:+9715XXXXXXXX" }
app.post('/missed-call', async (req, res) => {
  try {
    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    const to   = req.body.to;
    const lang = req.body.lang || 'ar';
    const msg  = MSG.missedCall[lang](lang === 'ar' ? CLINIC.nameAr : CLINIC.nameEn);

    await twilio.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to,
      body: msg,
    });

    // Set session state so bot is ready for their reply
    const session      = getSession(to);
    session.state      = 'MAIN_MENU';
    session.lang       = lang;

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.send(`
    <h2>🤖 مساعد العيادة — WhatsApp Bot</h2>
    <p>Status: ✅ Running</p>
    <p>Webhook: POST /whatsapp</p>
    <p>Missed call trigger: POST /missed-call</p>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Bot running on port ${PORT}`));
