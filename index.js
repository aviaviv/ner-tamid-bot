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
    
    if (!msg) return;

    // זיהוי סוג ההודעה: טקסט חופשי או לחיצה על רשימה
    if (msg.type === 'text') {
        await handleSearch(msg.from, msg.text.body.trim());
    } else if (msg.type === 'interactive' && msg.interactive.type === 'list_reply') {
        // המשתמש לחץ על כפתור מהרשימה! נחלץ את ה-ID
        const graveId = msg.interactive.list_reply.id.replace('grave_', '');
        await handleExactMatch(msg.from, graveId);
    }
});

// פונקציה חדשה: מופעלת רק כאשר המשתמש לוחץ על שם ספציפי מתוך רשימה
async function handleExactMatch(senderPhone, graveId) {
    try {
        const { data: records, error } = await supabase
            .from('deceased_records')
            .select('*')
            .eq('id', graveId)
            .limit(1);

        if (error) throw error;
        
        if (records && records.length > 0) {
            const msg = formatSingleResult(records[0]);
            await sendWhatsApp(senderPhone, msg);
        }
    } catch (err) {
        console.error("❌ תקלה בשליפת רשומה ספציפית:", err);
        await sendWhatsApp(senderPhone, "⚠️ אירעה תקלה בשליפת הנתונים. אנא נסו שוב.");
    }
}

async function handleSearch(senderPhone, searchQuery) {
    if (!searchQuery || searchQuery.trim().length < 2) {
        await sendWhatsApp(senderPhone, "אנא שלחו שם לחיפוש (לפחות 2 אותיות).");
        return;
    }

    try {
        const searchWords = searchQuery.toLowerCase().split(/\s+/);
        
        let query = supabase
            .from('deceased_records')
            .select('*')
            .eq('is_approved', true);

        searchWords.forEach(word => {
            query = query.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%,cemetery_name.ilike.%${word}%,hebrew_death_date.ilike.%${word}%`);
        });
        
        const { data: matches, error } = await query.limit(50);

        if (error) throw error;

        // ── סינון כפילויות קלאסי שכתבת ─────────────────────────────
        const seen = new Set();
        const unique = (matches || []).filter(d => {
            const key = [
                (d.first_name  || '').trim().toLowerCase(),
                (d.last_name   || '').trim().toLowerCase(),
                (d.cemetery_name || '').trim().toLowerCase(),
                (d.grave_number  || '').toString().trim()
            ].join('|');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        // ────────────────────────────────────────────────────────────

        const resultsCount = unique.length;
        
        // הגדרת בתי העלמין כאן כדי שכל המצבים יוכלו להשתמש בזה
        const uniqueCemeteries = [...new Set(unique.map(r => r.cemetery_name).filter(Boolean))];

        if (resultsCount === 1) {
            // מצב 1: תוצאה אחת בלבד - יורים אותה ישר למשתמש
            const msg = formatSingleResult(unique[0]);
            await sendWhatsApp(senderPhone, msg);

        } else if (resultsCount > 1 && resultsCount <= 10) {
            // מצב 2: עד 10 תוצאות - מציגים תפריט אינטראקטיבי
            const rows = unique.map(d => {
                const title = `${d.first_name || ''} ${d.last_name || ''}`.trim().substring(0, 24);
                let year = 'לא ידוע';
                if (d.gregorian_death_date) {
                    year = String(d.gregorian_death_date).split('-')[0];
                }
                const desc = `${d.cemetery_name || '-'} | שנת פטירה: ${year}`.substring(0, 72);
                
                return {
                    id: `grave_${d.id}`,
                    title: title,
                    description: desc
                };
            });

            await sendWhatsAppInteractive(senderPhone, 
                `🕯️ *נמצאו ${resultsCount} תוצאות עבור השם ב${uniqueCemeteries[0] || 'בית העלמין'}.*\n\n` +
                `מכיוון שוואטסאפ מגבילה ל-10 תוצאות בתפריט, הנה 10 הראשונות:\n\n` +
                `*(אם הנפטר לא מופיע כאן, שלחו שוב את השם בתוספת שנת הפטירה בלבד. למשל: "${searchQuery} תשע"א" או "${searchQuery} 2011")*`, 
                rows
            );

        } else if (resultsCount > 10) {
            // מצב 3 המאוחד: מעל 10 תוצאות - תמיד מציגים 10 ראשונות ומבקשים למקד עם שנה
            const top10 = unique.slice(0, 10);
            const rows = top10.map(d => {
                let title = `${d.first_name || ''} ${d.last_name || ''}`.trim() || 'שם לא ידוע';
                title = title.substring(0, 24); 
                
                let year = 'לא ידוע';
                if (d.gregorian_death_date) {
                    year = String(d.gregorian_death_date).split('-')[0];
                }
                // מציגים בתיאור גם את בית העלמין וגם את שנת הפטירה
                const desc = `${d.cemetery_name || '-'} | פטירה: ${year}`.substring(0, 72);
                
                return {
                    id: `grave_${d.id}`,
                    title: title,
                    description: desc
                };
            });

            // לוקחים רק את 2 המילים הראשונות מהחיפוש בשביל הדוגמה (כדי למנוע "מזל כהן ירקון תשע"א")
            const baseName = searchWords.slice(0, 2).join(' ');

            await sendWhatsAppInteractive(senderPhone, 
                `🕯️ *נמצאו ${resultsCount} תוצאות במאגר.*\n\n` +
                `מכיוון שוואטסאפ מגבילה את התפריט ל-10 שורות, הנה 10 התוצאות הראשונות:\n\n` +
                `*(אם יקירכם לא מופיע ברשימה, שלחו שוב את השם בתוספת שנת פטירה. למשל: "${baseName} תשע"א" או "${baseName} 2011")*`, 
                rows
            );

        } else {
            // 0 תוצאות
            await sendWhatsApp(senderPhone, 
                `🕯️ *ברוכים הבאים למערכת 'נר תמיד'*\n\n` +
                `לא מצאנו במאגר נפטר התואם לחיפוש "${searchQuery}".\n\n` +
                `➕ *להוספת הנפטר למאגר לחצו כאן:*\n` +
                `https://ner-tamid.netlify.app/nn\n\n` +
                `🔍 *איך מחפשים?*\n` +
                `פשוט שלחו לי את שמו של הנפטר, ואחפש במאגר. ניתן גם להוסיף את שם בית העלמין כדי למקד.\n\n` +
                `───────────────\n` +
                `⚠️ _הבהרה: המערכת הינה מיזם התנדבותי פרטי. הנתונים נאספו ממקורות גלויים וייתכנו אי-דיוקים. ההסתמכות על המידע באחריות המשתמש._\n\n` +
                `💡 *המיזם הוקם מתוך שליחות ע"י אבי אביב.*\n` +
                `ליצירת קשר: nertamid.app@gmail.com`
            );
        }

    } catch (err) {
        console.error("❌ תקלה:", err);
        await sendWhatsApp(senderPhone, 
            `⚠️ *מצטערים, החיפוש רחב מדי או שאירעה תקלה.*\n\n` +
            `נראה שהשם שחיפשת ("${searchQuery}") נפוץ מאוד במאגר או שיש עומס.\n\n` +
            `🔍 *איך למקד את החיפוש?*\n` +
            `אנא נסו לשלוח שוב את השם, בתוספת אחד מהפרטים הבאים:\n` +
            `• *שם משפחה* (לדוגמה: "${searchQuery} כהן")\n` +
            `• *שם בית העלמין* (לדוגמה: "${searchQuery} ירקון")\n` +
            `• *שנת פטירה* (לדוגמה: "${searchQuery} תשע"א" או "${searchQuery} 2011")`
        );
    }
}

// פונקציית עזר לעיצוב רשומה בודדת (מונעת כפילות קוד)
function formatSingleResult(d) {
    let gregorianStr = '-';
    if (d.gregorian_death_date) {
        const parts = d.gregorian_death_date.split('-');
        if (parts.length === 3) {
            gregorianStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
        } else {
            gregorianStr = d.gregorian_death_date;
        }
    }

    let msg = `🕯️ *נמצאה תוצאה מדויקת:*\n\n`;
    msg += `👤 *${d.first_name || ''} ${d.last_name || ''}*\n` +
           `📅 עברי: ${d.hebrew_death_date || '-'}\n` +
           `🗓️ לועזי: ${gregorianStr}\n` +
           `📍 ${d.cemetery_name || '-'}\n` +
           `🏛️ חלקה: ${d.section || '-'}, שורה: ${d.row || '-'}, קבר: ${d.grave_number || '-'}\n`;
    
    if (d.notes) {
        let cleanNotes = d.notes.replace(/לפתיחת עמוד זיכרון/g, '').replace(/-/g, '').trim();
        if (cleanNotes.length > 0) {
            msg += `📝 הערות ניווט: ${cleanNotes}\n`;
        }
    }
    
    msg += `───────────────\n⚠️ _הבהרה: ייתכנו אי-דיוקים והסתמכות על נתוני הניווט הינה באחריות המשתמש._\n`;
    return msg;
}

// פונקציות תקשורת עם וואטסאפ (טקסט רגיל)
async function sendWhatsApp(to, text) {
    await fetch(`https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'text', text: { body: text } }),
    });
}

// פונקציה חדשה: תקשורת עם וואטסאפ (תפריט בחירה אינטראקטיבי)
async function sendWhatsAppInteractive(to, bodyText, rows) {
    const payload = {
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'interactive',
        interactive: {
            type: 'list',
            body: { text: bodyText },
            action: {
                button: 'בחר/י נפטר',
                sections: [{ title: 'תוצאות תואמות', rows: rows }]
            }
        }
    };

    await fetch(`https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        body: JSON.stringify(payload),
    });
}

app.listen(3000, () => console.log("🚀 בוט 'נר תמיד' פעיל!"));
