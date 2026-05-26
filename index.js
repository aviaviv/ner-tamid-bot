'use strict';

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const WELCOME_TEXT = 
    `🕯️ *ברוכים הבאים למערכת 'נר תמיד'*\n\n` +
    `אנו כאן כדי לעזור לכם לאתר בקלות את מיקום קברי יקיריכם, ולשמור על זכרם.\n\n` +
    `🔍 *איך מחפשים?*\n` +
    `פשוט שלחו לי את שמו של הנפטר (שם פרטי, שם משפחה או שניהם), ואחפש במאגר.\n\n` +
    `💡 *טיפ:* שלחו את המילה 'שלום' בכל שלב כדי לחזור להודעה זו.`;

// ✅ אימות Webhook מול פורטל מטא (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const MY_VERIFY_TOKEN = 'ner-tamid-2026';
  if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// קבלת הודעות מוואטסאפ (POST)
app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    const body = req.body;
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg?.type === 'text') {
        await handleTextMessage(msg.from, msg.text.body.trim());
    }
});

async function handleTextMessage(senderPhone, text) {
    const lowerText = text.toLowerCase();
    const greetings = ['היי', 'שלום', 'hi', 'hello', 'בוקר טוב', 'ערב טוב', 'תפריט', 'עזרה', 'תודה'];
    if (greetings.includes(lowerText)) {
        await sendWhatsApp(senderPhone, WELCOME_TEXT);
    } else {
        await handleSearch(senderPhone, text);
    }
}

async function handleSearch(senderPhone, searchQuery) {
    try {
        const { data, error } = await supabase.from('deceased_records').select('*');
        if (error) { console.error("❌ שגיאת Supabase:", error); return; }

        const matches = (data || []).filter(r => {
            const fullName1 = ((r.first_name || '') + " " + (r.last_name || '')).trim();
            const fullName2 = ((r.last_name || '') + " " + (r.first_name || '')).trim();
            return fullName1.includes(searchQuery) || fullName2.includes(searchQuery);
        });

        if (matches.length > 0) {
            let msg = `🕯️ *מצאתי ${matches.length} תוצאות במערכת 'נר תמיד':*\n\n`;
            matches.slice(0, 3).forEach(d => {
                msg += `👤 *${d.first_name || ''} ${d.last_name || ''}*\n` +
                       `📅 *תאריך פטירה:* ${d.hebrew_death_date || '-'}\n` +
                       `📍 *בית קברות:* ${d.cemetery_name || '-'}\n` +
                       `🏛️ *מיקום:* חלקה ${d.section || '-'}, שורה ${d.row || '-'}, קבר ${d.grave_number || '-'}\n` +
                       `📝 *הערות:* ${d.notes || 'אין'}\n───────────────\n`;
            });
            await sendWhatsApp(senderPhone, msg);
        } else {
            await sendWhatsApp(senderPhone, `לא מצאנו במאגר נפטר בשם "${searchQuery}".\n\n${WELCOME_TEXT}`);
        }
    } catch (err) {
        console.error("❌ תקלה:", err);
    }
}

async function sendWhatsApp(to, text) {
    try {
        await fetch(`https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WHATSAPP_TOKEN}` },
            body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'text', text: { body: text } }),
        });
    } catch (err) {
        console.error("❌ שגיאה בשליחת הודעה:", err.message);
    }
}

app.listen(3000, () => console.log("🚀 בוט 'נר תמיד' פעיל וממתין להודעות..."));