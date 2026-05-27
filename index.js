'use strict';

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const WELCOME_TEXT = `🕯️ *ברוכים הבאים למערכת 'נר תמיד'*\n\nשלחו לי את שמו של הנפטר ואחפש במאגר.`;

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === 'ner-tamid-2026') {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg?.type === 'text') {
        await handleSearch(msg.from, msg.text.body.trim());
    }
});

async function handleSearch(senderPhone, searchQuery) {
    if (!searchQuery || searchQuery.trim().length < 2) {
        await sendWhatsApp(senderPhone, "אנא שלחו שם לחיפוש (לפחות 2 אותיות).");
        return;
    }

    try {
        const { data, error } = await supabase
            .from('deceased_records')
            .select('*')
            .eq('is_approved', true);

        if (error) throw error;

        const matches = (data || []).filter(r => {
            const text = `${r.first_name} ${r.last_name} ${r.section} ${r.grave_number}`.toLowerCase();
            return text.includes(searchQuery.toLowerCase());
        });

        if (matches.length > 0) {
            let msg = `🕯️ *נמצאו ${matches.length} תוצאות:*\n\n`;
            matches.slice(0, 3).forEach(d => {
                msg += `👤 *${d.first_name} ${d.last_name}*\n` +
                       `📅 ${d.hebrew_death_date || '-'}\n` +
                       `📍 ${d.cemetery_name || '-'}\n` +
                       `🏛️ חלקה: ${d.section || '-'}, שורה: ${d.row || '-'}, קבר: ${d.grave_number || '-'}\n───────────────\n`;
            });
            await sendWhatsApp(senderPhone, msg);
} else {
            await sendWhatsApp(senderPhone, 
                `🕯️ *ברוכים הבאים למערכת 'נר תמיד'*\n\n` +
                `לא מצאנו במאגר נפטר בשם "${searchQuery}".\n\n` +
                `➕ *להוספת הנפטר למאגר לחצו כאן:*\n` +
                `https://ner-tamid.netlify.app/\n\n` +
                `🔍 *איך מחפשים?*\n` +
                `פשוט שלחו לי את שמו של הנפטר (שם פרטי, שם משפחה או שניהם), ואחפש במאגר.`
            );
        }
    } catch (err) {
        console.error("❌ תקלה:", err);
    }
}

async function sendWhatsApp(to, text) {
    await fetch(`https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'text', text: { body: text } }),
    });
}

app.listen(3000, () => console.log("🚀 בוט 'נר תמיד' פעיל!"));
