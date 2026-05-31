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
        // פירוק מילות החיפוש למערך של מילים נפרדות (לפי רווחים)
        const searchWords = searchQuery.toLowerCase().split(/\s+/);
        
        // מתחילים לבנות את השאילתה מול בסיס הנתונים (ולא מושכים את הכל לזיכרון!)
        let query = supabase
            .from('deceased_records')
            .select('*')
            .eq('is_approved', true);

        // מוסיפים פילטר לכל מילה בחיפוש מול עמודות הטקסט הרלוונטיות בטבלה
        searchWords.forEach(word => {
            query = query.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%,cemetery_name.ilike.%${word}%,section.ilike.%${word}%`);
        });

        // נבקש מהמסד להחזיר רק את 10 התוצאות הראשונות שמתאימות במדויק לחיפוש
        const { data: matches, error } = await query.limit(10);

        if (error) throw error;

        if (matches && matches.length > 0) {
            let msg = `🕯️ *נמצאו ${matches.length} תוצאות*\n`;
            
            // חיווי למשתמש אם יש הרבה תוצאות
            if (matches.length === 10) {
                msg += `_(מציג את 3 התוצאות הראשונות מתוך רבות. מומלץ למקד את החיפוש עם שם משפחה או בית עלמין)_:\n\n`;
            } else if (matches.length > 3) {
                msg += `_(מציג את 3 התוצאות הראשונות. מומלץ למקד את החיפוש)_:\n\n`;
            } else {
                msg += `\n`;
            }

            // לוקחים רק את 3 הראשונים לתצוגה בוואטסאפ
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
     // הוספת שורת ההערות - תוך ניקוי טקסט לא רצוי ("לפתיחת עמוד זיכרון")
                if (d.notes) {
                    // מנקים את המחרוזת מכל מיני וריאציות אפשריות של הטקסט
                    let cleanNotes = d.notes.replace(/לפתיחת עמוד זיכרון/g, '').replace(/-/g, '').trim();
                    
                    // אם אחרי הניקוי נשאר טקסט אמיתי, נציג אותו
                    if (cleanNotes.length > 0) {
                        msg += `📝 הערות ניווט: ${cleanNotes}\n`;
                    }
                }
                
                msg += `───────────────\n`;
            });
            await sendWhatsApp(senderPhone, msg);
} else {
            await sendWhatsApp(senderPhone, 
                `🕯️ *ברוכים הבאים למערכת 'נר תמיד'*\n\n` +
                `לא מצאנו במאגר נפטר התואם לחיפוש "${searchQuery}".\n\n` +
                `➕ *להוספת הנפטר למאגר לחצו כאן:*\n` +
                `https://ner-tamid.netlify.app/nn` +
                `🔍 *איך מחפשים?*\n` +
                `פשוט שלחו לי את שמו של הנפטר (שם פרטי, שם משפחה או שניהם), ואחפש במאגר. ניתן גם להוסיף את שם בית העלמין כדי למקד את החיפוש (למשל: "ישראל ישראלי ירקון").\n\n` +
                `───────────────\n` +
                `💡 *המיזם הוקם מתוך שליחות ע"י אבי אביב.*\n` +
                `ליצירת קשר, הצעות ייעול או פניות עסקיות:\n` +
                `nertamid.app@gmail.com`
            );
        }
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
