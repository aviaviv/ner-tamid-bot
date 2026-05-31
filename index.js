'use strict';

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

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

        // פירוק מילות החיפוש למערך של מילים נפרדות (לפי רווחים)
        const searchWords = searchQuery.toLowerCase().split(/\s+/);

        const matches = (data || []).filter(r => {
            // יצירת "שק" של כל פרטי הנפטר לתוך טקסט אחד
            const text = `${r.first_name} ${r.last_name} ${r.cemetery_name} ${r.section} ${r.grave_number} ${r.hebrew_death_date}`.toLowerCase();
            
            // בדיקה האם *כל* המילים שהמשתמש הקליד קיימות בתוך הטקסט של הנפטר (לא משנה באיזה סדר)
            return searchWords.every(word => text.includes(word));
        });

        if (matches.length > 0) {
            let msg = `🕯️ *נמצאו ${matches.length} תוצאות*\n`;
            
            // חיווי למשתמש אם יש יותר מ-3 תוצאות כדי שידע למקד את החיפוש
            if (matches.length > 3) {
                msg += `_(מציג את 3 התוצאות הראשונות. מומלץ להוסיף שם משפחה או את שם בית העלמין כדי למקד את החיפוש)_:\n\n`;
            } else {
                msg += `\n`;
            }

            matches.slice(0, 3).forEach(d => {
                
                // סידור התאריך הלועזי לפורמט ישראלי (DD/MM/YYYY)
                let gregorianStr = '-';
                if (d.gregorian_death_date) {
                    const parts = d.gregorian_death_date.split('-');
                    if (parts.length === 3) {
                        gregorianStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
                    } else {
                        gregorianStr = d.gregorian_death_date; // במקרה שהפורמט שונה
                    }
                }

                msg += `👤 *${d.first_name} ${d.last_name}*\n` +
                       `📅 עברי: ${d.hebrew_death_date || '-'}\n` +
                       `🗓️ לועזי: ${gregorianStr}\n` +
                       `📍 ${d.cemetery_name || '-'}\n` +
                       `🏛️ חלקה: ${d.section || '-'}, שורה: ${d.row || '-'}, קבר: ${d.grave_number || '-'}\n`;
                
                // הוספת שורת ההערות במידה והמשתמש הזין כאלו בטופס
                if (d.notes) {
                    msg += `📝 הערות ניווט: ${d.notes}\n`;
                }
                
                msg += `───────────────\n`;
            });
            await sendWhatsApp(senderPhone, msg);
        } else {
            await sendWhatsApp(senderPhone, 
                `🕯️ *ברוכים הבאים למערכת 'נר תמיד'*\n\n` +
                `לא מצאנו במאגר נפטר התואם לחיפוש "${searchQuery}".\n\n` +
                `➕ *להוספת הנפטר למאגר לחצו כאן:*\n` +
                `https://ner-tamid.netlify.app/\n\n` +
                `🔍 *איך מחפשים?*\n` +
                `פשוט שלחו לי את שמו של הנפטר (שם פרטי, שם משפחה או שניהם), ואחפש במאגר. ניתן גם להוסיף את שם בית העלמין כדי למקד את החיפוש (למשל: "ישראל ישראלי ירקון").`
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
