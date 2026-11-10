//+------------------------------------------------------------------+
//|                                                    Telegram.mqh  |
//|              The Architect EA - Telegram Trade Alerts            |
//|                                                                  |
//|  Sends trade open/close notifications to a Telegram chat via    |
//|  the Bot API using MT5's native WebRequest.                     |
//|                                                                  |
//|  Setup:                                                          |
//|    1. Create a Telegram bot via @BotFather → copy API token     |
//|    2. Add bot to your channel/group → get Chat ID               |
//|       (send a message, then visit:                              |
//|        https://api.telegram.org/bot<TOKEN>/getUpdates)          |
//|    3. Enable WebRequest in MT5:                                  |
//|       Tools → Options → Expert Advisors →                       |
//|       Allow WebRequest for listed URLs →                        |
//|       add: https://api.telegram.org                             |
//|    4. Set Inp_TelegramToken and Inp_TelegramChatId in EA inputs  |
//|                                                                  |
//|  Rate limiting: Telegram allows ~1 msg/sec per bot.             |
//|  This module sends at most one message per trade event.         |
//+------------------------------------------------------------------+
#ifndef __TELEGRAM_MQH__
#define __TELEGRAM_MQH__

#define TG_TIMEOUT_MS      1200
#define TG_MIN_INTERVAL_MS 1500

uint gTelegramLastSendMs = 0;

//+------------------------------------------------------------------+
//| TelegramSend                                                     |
//| Sends a plain-text message to the configured chat.              |
//| Returns true on success (HTTP 200).                              |
//+------------------------------------------------------------------+
bool TelegramSend(const string token, const string chatId, const string text)
{
   if(token == "" || chatId == "") return false;

   uint nowMs = GetTickCount();
   if((uint)(nowMs - gTelegramLastSendMs) < TG_MIN_INTERVAL_MS)
      return false;

   gTelegramLastSendMs = nowMs;

   // Build URL
   string url = "https://api.telegram.org/bot" + token + "/sendMessage";

   // Build JSON payload using fast_json builder
   CJsonBuilder jb;
   jb.Obj();
   jb.Key("chat_id").Val(chatId);
   jb.Key("text").Val(text);
   jb.Key("parse_mode").Val("HTML");
   jb.EndObj();
   string payload = jb.Build();

   // Encode as UTF-8 bytes
   uchar  postData[];
   StringToCharArray(payload, postData, 0, StringLen(payload));

   // HTTP headers
   string headers = "Content-Type: application/json\r\n";
   char   response[];
   string responseHeaders;
   int    timeout = TG_TIMEOUT_MS;

   int httpCode = WebRequest("POST", url, headers, timeout, postData, response, responseHeaders);

   if(httpCode == 200)
   {
      Print("[TG] Sent: ", StringLen(text), " chars");
      return true;
   }
   else
   {
      Print("[TG] Send failed — HTTP ", httpCode,
            " err=", GetLastError(),
            " (check Tools→Options→Expert Advisors→WebRequest URLs)");
      return false;
   }
}

//+------------------------------------------------------------------+
//| TelegramTradeOpen                                                |
//| Call after a successful ExecuteTrade.                            |
//+------------------------------------------------------------------+
void TelegramTradeOpen(const string token, const string chatId,
                       ENUM_SIGNAL sig, double lot, double sl, double tp,
                       double entry)
{
   if(token == "" || chatId == "") return;

   string dir = (sig == SIGNAL_LONG) ? "🟢 BUY" : "🔴 SELL";
   string msg = StringFormat(
      "<b>THE ARCHITECT — Trade Open</b>\n"
      "%s  %s\n"
      "Entry: <code>%.5f</code>\n"
      "SL:    <code>%.5f</code>\n"
      "TP:    <code>%.5f</code>\n"
      "Lot:   <code>%.2f</code>",
      dir, _Symbol,
      entry, sl, tp, lot);

   TelegramSend(token, chatId, msg);
}

//+------------------------------------------------------------------+
//| TelegramTradeClose                                               |
//| Call after a trade closes (e.g. from OnTradeTransaction).        |
//+------------------------------------------------------------------+
void TelegramTradeClose(const string token, const string chatId,
                        double profit, double entryPrice, double closePrice)
{
   if(token == "" || chatId == "") return;

   string emoji = (profit >= 0.0) ? "✅" : "❌";
   string msg = StringFormat(
      "<b>THE ARCHITECT — Trade Closed</b>\n"
      "%s  %s\n"
      "Entry: <code>%.5f</code> → Close: <code>%.5f</code>\n"
      "P/L:   <b>%+.2f USD</b>",
      emoji, _Symbol,
      entryPrice, closePrice, profit);

   TelegramSend(token, chatId, msg);
}

//+------------------------------------------------------------------+
//| TelegramOptimAlert                                               |
//| Notify when Manager triggers a self-optimization cycle.          |
//+------------------------------------------------------------------+
void TelegramOptimAlert(const string token, const string chatId, int optimCount)
{
   if(token == "" || chatId == "") return;

   string msg = StringFormat(
      "⚙️ <b>THE ARCHITECT — Re-optimizing</b>\n"
      "Cycle #%d  |  %s  |  %s",
      optimCount, _Symbol, TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES));

   TelegramSend(token, chatId, msg);
}

#endif
