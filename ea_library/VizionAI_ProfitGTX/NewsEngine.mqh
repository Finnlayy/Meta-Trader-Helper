#ifndef NEWS_ENGINE_MQH
#define NEWS_ENGINE_MQH

string g_symbol_base  = "";
string g_symbol_quote = "";

double NewsValueToDouble(const long v)
{
   return ((double)v) / 1000000.0;
}

// Simple JSON escape — avoids dependency on GWJsonEscape (defined later in AIGateway.mqh)
string NE_Escape(const string s)
{
   string x = s;
   StringReplace(x, "\\", "\\\\");
   StringReplace(x, "\"", "'");
   StringReplace(x, "\n", " ");
   StringReplace(x, "\r", " ");
   return x;
}

void InitNewsEngine()
{
   string s = _Symbol;
   StringToUpper(s);
   g_symbol_base  = StringSubstr(s, 0, 3);
   g_symbol_quote = StringSubstr(s, 3, 3);

   News_Bias_Direction          = 0;
   News_Bias_Strength           = 0.0;
   News_Trade_Block_Active      = false;
   News_Trade_Allowed_Direction = 0;
   News_Last_Headline           = "";
   News_Last_Update             = 0;
   News_Pending_Events_JSON     = "[]";
}

int CurrencyImpactSign(const string ccy)
{
   if(ccy == g_symbol_base) return 1;
   if(ccy == g_symbol_quote) return -1;
   if(ccy == "USD" && (g_symbol_base == "XAU" || g_symbol_base == "XAG" ||
                        g_symbol_base == "BTC" || g_symbol_base == "ETH"))
      return -1;
   return 0;
}

string DetectEventCurrency(const string event_name)
{
   string name = event_name;
   StringToUpper(name);
   if(StringFind(name, g_symbol_base)  >= 0) return g_symbol_base;
   if(StringFind(name, g_symbol_quote) >= 0) return g_symbol_quote;
   return g_symbol_base;
}

void UpdateNewsBiasFromCalendar()
{
   if(!Use_News_Filter)
      return;

   datetime now  = TimeTradeServer();
   datetime from = now - (News_Lookback_Minutes * 60);

   ulong last_id = 0;
   MqlCalendarValue vals[];
   ArrayResize(vals, 0);

   int n = CalendarValueLast(last_id, vals, "", "");
   if(n <= 0)
   {
      News_Last_Update = now;
      return;
   }

   double score          = 0.0;
   bool   high_impact_near = false;
   string last_headline  = "";

   // JSON builder for upcoming high-impact events (sent to AI gateway)
   string events_json = "[";
   int    events_count = 0;

   for(int i = 0; i < n; ++i)
   {
      if(vals[i].time < from)
         continue;

      MqlCalendarEvent evt;
      if(!CalendarEventById(vals[i].event_id, evt))
         continue;

      MqlCalendarCountry country;
      if(!CalendarCountryById(evt.country_id, country))
         continue;

      int sign = CurrencyImpactSign(country.currency);
      if(sign == 0)
         continue;

      int    importance  = (int)evt.importance;
      double imp_weight  = 1.0;
      if(importance >= 2) imp_weight = 2.0;
      if(importance >= 3) imp_weight = 3.0;

      double actual   = NewsValueToDouble(vals[i].actual_value);
      double forecast = NewsValueToDouble(vals[i].forecast_value);
      double previous = NewsValueToDouble(vals[i].prev_value);

      double surprise = actual - forecast;
      if(MathAbs(surprise) < 0.000001)
         surprise = actual - previous;

      if(MathAbs(surprise) < 0.000001)
         continue;

      double ev_score = surprise * imp_weight * sign;
      score += ev_score;

      // Check if this is a high-impact event within the block window
      double secs_away = MathAbs((double)(vals[i].time - now));
      if(importance >= 3 && MathAbs(ev_score) > 0.0)
      {
         if(secs_away <= (double)(News_HighImpact_Block_Minutes * 60))
            high_impact_near = true;
      }

      // Collect upcoming high-impact events for AI enrichment
      if(importance >= 3 && vals[i].time > now &&
         (vals[i].time - now) <= (datetime)(News_Lookahead_Minutes * 60))
      {
         if(events_count > 0) events_json += ",";
         events_json += "{";
         events_json += "\"name\":\"" + NE_Escape(evt.name) + "\",";
         events_json += "\"currency\":\"" + country.currency + "\",";
         events_json += "\"importance\":" + IntegerToString(importance) + ",";
         events_json += "\"minutes_until\":" + IntegerToString((int)((vals[i].time - now) / 60)) + ",";
         events_json += "\"actual\":" + DoubleToString(actual, 6) + ",";
         events_json += "\"forecast\":" + DoubleToString(forecast, 6) + ",";
         events_json += "\"previous\":" + DoubleToString(previous, 6) + ",";
         events_json += "\"surprise\":" + DoubleToString(surprise * sign, 6);
         events_json += "}";
         events_count++;
      }

      last_headline = country.currency + " " + evt.name;
   }

   events_json += "]";
   News_Pending_Events_JSON = events_json;

   // Set directional bias
   if(score > 0.0)       News_Bias_Direction = 1;
   else if(score < 0.0)  News_Bias_Direction = -1;
   else                  News_Bias_Direction = 0;

   News_Bias_Strength = MathMin(100.0, MathAbs(score) * 10.0);

   // ── Directional gate logic ──────────────────────────────────────────────
   // High-impact event near: trade the news direction instead of hard-blocking,
   // provided we have a clear directional signal strong enough to trust.
   if(high_impact_near)
   {
      if(Use_News_Directional_Trading &&
         News_Bias_Direction != 0 &&
         News_Bias_Strength >= News_Directional_Min_Strength)
      {
         // Gate open for news-aligned direction only
         News_Trade_Block_Active      = false;
         News_Trade_Allowed_Direction = News_Bias_Direction;
      }
      else
      {
         // No clear direction (or directional mode disabled) — hard block
         News_Trade_Block_Active      = true;
         News_Trade_Allowed_Direction = 0;
      }
   }
   else
   {
      // No high-impact event nearby — open for business
      News_Trade_Block_Active      = false;
      News_Trade_Allowed_Direction = 0;
   }

   if(last_headline != "") News_Last_Headline = last_headline;
   News_Last_Update = now;
}

void BuildNewsReport()
{
   string dir = "NEUTRAL";
   if(News_Bias_Direction > 0) dir = "BULL";
   if(News_Bias_Direction < 0) dir = "BEAR";

   string gate = "open";
   if(News_Trade_Block_Active)             gate = "BLOCKED";
   else if(News_Trade_Allowed_Direction == 1)  gate = "BUY-ONLY";
   else if(News_Trade_Allowed_Direction == -1) gate = "SELL-ONLY";

   News_Bias_Report = "NEWS " + dir +
                      " | str=" + DoubleToString(News_Bias_Strength, 1) +
                      " | gate=" + gate +
                      " | " + News_Last_Headline;
}

void UpdateNewsEngine()
{
   GW_News_Block_Flag = false;  // Reset gateway news block each update cycle
   UpdateNewsBiasFromCalendar();
   AIFetchNewsBias();  // Overlay live news from gateway (merges if stronger signal)

   // Gateway hard-block overrides directional mode
   if(GW_News_Block_Flag)
   {
      News_Trade_Block_Active      = true;
      News_Trade_Allowed_Direction = 0;
   }

   BuildNewsReport();

   if(StringLen(GW_News_Headlines) > 0)
      News_Bias_Report += " | GW: " + StringSubstr(GW_News_Headlines, 0, 80);
}

#endif
