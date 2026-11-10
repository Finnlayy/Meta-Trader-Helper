#ifndef AI_GATEWAY_MQH
#define AI_GATEWAY_MQH

// ---------------------------------------------------------------------------
// AIGateway.mqh — Unified AI Gateway for profitgtx
// Routes EA requests through n8n → OpenRouter → Claude Sonnet
// Actions: validate_trade, get_briefing, get_session, get_news_bias,
//          report_trade, watchlist_status, ping
//
// URL routing is handled by AutoDetectDeployment() which sets g_gw_url.
// ---------------------------------------------------------------------------

string GW_LastError = "";

// ─── JSON helpers ────────────────────────────────────────────────────────────

string GWJsonEscape(const string s)
{
   string x = s;
   StringReplace(x, "\\", "\\\\");
   StringReplace(x, "\"", "\\\"");
   StringReplace(x, "\n", " ");
   StringReplace(x, "\r", " ");
   return x;
}

bool GWExtractString(const string &json, const string &key, string &out)
{
   int k = StringFind(json, "\"" + key + "\"");
   if(k < 0) return false;
   int colon = StringFind(json, ":", k);
   if(colon < 0) return false;
   int q1 = StringFind(json, "\"", colon + 1);
   if(q1 < 0) return false;
   int q2 = StringFind(json, "\"", q1 + 1);
   if(q2 < 0) return false;
   out = StringSubstr(json, q1 + 1, q2 - q1 - 1);
   return true;
}

bool GWExtractNumber(const string &json, const string &key, double &out)
{
   int k = StringFind(json, "\"" + key + "\"");
   if(k < 0) return false;
   int colon = StringFind(json, ":", k);
   if(colon < 0) return false;
   int endComma = StringFind(json, ",", colon);
   int endBrace = StringFind(json, "}", colon);
   int end = endComma;
   if(end < 0 || (endBrace >= 0 && endBrace < end)) end = endBrace;
   if(end < 0) return false;
   string val = StringSubstr(json, colon + 1, end - (colon + 1));
   StringTrimLeft(val);
   StringTrimRight(val);
   out = StringToDouble(val);
   return true;
}

bool GWExtractBool(const string &json, const string &key, bool &out)
{
   int k = StringFind(json, "\"" + key + "\"");
   if(k < 0) return false;
   int colon = StringFind(json, ":", k);
   if(colon < 0) return false;
   string rest = StringSubstr(json, colon + 1, 10);
   StringTrimLeft(rest);
   StringToLower(rest);
   out = (StringFind(rest, "true") == 0);
   return true;
}

// ─── Deployment auto-detection ────────────────────────────────────────────────
//
// Probes the internal NN endpoint with a 1.5 s timeout.
// If it responds (any HTTP code) → container socat bridges are up → use internal URLs.
// Otherwise → laptop / VPN → use public HTTPS URLs.
// DeploymentProfile input overrides AUTO behaviour.

void AutoDetectDeployment()
{
   if(DeploymentProfile == "CONTAINER")
   {
      g_nn_url       = NN_URL_Internal;
      g_gw_url       = GW_URL_Internal;
      g_is_container = true;
      Print("Deploy: CONTAINER (manual) | NN=", g_nn_url, " | GW=", g_gw_url);
      return;
   }

   if(DeploymentProfile == "LAPTOP")
   {
      g_nn_url       = NN_URL_Laptop;
      g_gw_url       = GW_URL_Laptop;
      g_is_container = false;
      Print("Deploy: LAPTOP (manual) | NN=", g_nn_url, " | GW=", g_gw_url);
      return;
   }

   // AUTO — probe internal NN endpoint
   string probe_url = NN_URL_Internal;
   char   probe_data[], probe_result[];
   string probe_headers = "Content-Type: application/json\r\n";
   string probe_body    = "{\"symbol\":\"probe\",\"tf\":\"M1\",\"features\":{},\"feature_vector\":[]}";
   StringToCharArray(probe_body, probe_data, 0, WHOLE_ARRAY, CP_UTF8);
   string probe_resp_headers;

   ResetLastError();
   int code = WebRequest("POST", probe_url, probe_headers, 1500,
                         probe_data, probe_result, probe_resp_headers);

   if(code > 0)   // any server response means socat bridge is alive
   {
      g_nn_url       = NN_URL_Internal;
      g_gw_url       = GW_URL_Internal;
      g_is_container = true;
      Print("Deploy: AUTO → CONTAINER (internal NN responded HTTP ", code, ")");
   }
   else
   {
      g_nn_url       = NN_URL_Laptop;
      g_gw_url       = GW_URL_Laptop;
      g_is_container = false;
      Print("Deploy: AUTO → LAPTOP (internal NN unreachable, err=", GetLastError(), ") — using HTTPS");
   }

   Print("  NN  URL: ", g_nn_url);
   Print("  GW  URL: ", g_gw_url);
}

// ─── Core HTTP POST ───────────────────────────────────────────────────────────

bool GatewayRequest(const string action, const string json_payload, string &response)
{
   if(AI_Mode == "off")
      return false;

   if(StringLen(g_gw_url) < 10)
   {
      GW_LastError = "Gateway URL not resolved (AutoDetectDeployment not called?)";
      return false;
   }

   string headers = "Content-Type: application/json\r\n";
   if(StringLen(AI_Gateway_Token) > 0)
      headers += "X-Gateway-Token: " + AI_Gateway_Token + "\r\n";

   char post_data[], result_data[];
   string result_headers;
   StringToCharArray(json_payload, post_data, 0, StringLen(json_payload), CP_UTF8);

   ResetLastError();
   int code = WebRequest("POST", g_gw_url, headers, AI_TimeoutMs, post_data, result_data, result_headers);

   if(code <= 0 || code >= 400)
   {
      GW_LastError = "HTTP " + IntegerToString(code) + " err=" + IntegerToString(GetLastError());
      GW_Status = "ERROR";
      return false;
   }

   response = CharArrayToString(result_data, 0, -1, CP_UTF8);
   GW_Status = "ACTIVE";
   return true;
}

// ─── Initialize ───────────────────────────────────────────────────────────────

bool InitializeAIGateway()
{
   GW_Initialized = false;
   GW_Status = "NOT_INIT";
   GW_LastError = "";

   if(AI_Mode == "off")
   {
      GW_Status = "DISABLED";
      Print("AIGateway: Mode=off — AI calls disabled");
      return true;
   }

   string ping = "{\"action\":\"ping\",\"symbol\":\"" + GWJsonEscape(_Symbol) + "\"}";
   string resp;

   if(!GatewayRequest("ping", ping, resp))
   {
      if(AI_Mode == "advisory")
      {
         Print("AIGateway: Gateway unreachable — advisory mode, EA runs without AI gate | ", GW_LastError);
         GW_Status = "OFFLINE_ADVISORY";
         return true;
      }
      Print("AIGateway: Gateway init FAILED (mandatory mode) — ", GW_LastError);
      return false;
   }

   GW_Initialized = true;
   GW_Status = "ACTIVE";
   Print("AIGateway: OK | URL=", g_gw_url, " | Mode=", AI_Mode,
         " | env=", (g_is_container ? "CONTAINER" : "LAPTOP"));
   return true;
}

bool IsAIEnabled() { return GW_Initialized; }

// ─── Trade Validation ────────────────────────────────────────────────────────

bool AIValidateTrade(const string setup_name, const bool is_buy, double &size_multiplier)
{
   if(AI_Mode == "off")
      return true;

   if(!GW_Initialized)
   {
      if(AI_Mode == "advisory") { size_multiplier *= 0.5; return true; }
      return false;
   }

   if(!Use_Watchlist_Gate || IsSymbolActiveTrading(_Symbol))
   {
      // Watchlist check passed — continue to trade validation
   }
   else
   {
      Last_AI_Analysis = "[WL] " + _Symbol + " not in active-trading top-10";
      return false;
   }

   string dir = is_buy ? "BUY" : "SELL";
   string payload = "{";
   payload += "\"action\":\"validate_trade\",";
   payload += "\"symbol\":\"" + GWJsonEscape(_Symbol) + "\",";
   payload += "\"timeframe\":\"" + EnumToString((ENUM_TIMEFRAMES)Period()) + "\",";
   payload += "\"direction\":\"" + dir + "\",";
   payload += "\"setup\":\"" + GWJsonEscape(setup_name) + "\",";
   payload += "\"nn_bias\":" + IntegerToString(NN_Bias) + ",";
   payload += "\"nn_confidence\":" + DoubleToString(NN_Confidence, 2) + ",";
   payload += "\"mode\":\"" + GWJsonEscape(ModeToString(Current_Mode)) + "\",";
   payload += "\"state\":\"" + GWJsonEscape(StateToString(Current_State)) + "\",";
   payload += "\"warnings\":" + IntegerToString(Active_Warnings) + ",";
   payload += "\"praise\":" + IntegerToString(Active_Praise_Signals) + ",";
   payload += "\"cluster_strength\":" + DoubleToString(Coordinator_Cluster_Strength, 2) + ",";
   payload += "\"conflict_score\":" + DoubleToString(Coordinator_Conflict_Score, 2) + ",";
   payload += "\"news_bias\":" + IntegerToString(News_Bias_Direction) + ",";
   payload += "\"news_strength\":" + DoubleToString(News_Bias_Strength, 2) + ",";
   payload += "\"news_block\":" + (News_Trade_Block_Active || GW_News_Block_Flag ? "true" : "false") + ",";
   payload += "\"news_allowed_direction\":" + IntegerToString(News_Trade_Allowed_Direction) + ",";
   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double sl_pts = (Manual_SL_Points > 0) ? Manual_SL_Points * point : 0;
   double tp_pts = (Manual_TP_Points > 0) ? Manual_TP_Points * point : 0;
   double est_sl = is_buy ? bid - sl_pts : bid + sl_pts;
   double est_tp = is_buy ? bid + tp_pts : bid - tp_pts;
   payload += "\"entry\":" + DoubleToString(bid, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS)) + ",";
   payload += "\"sl\":" + DoubleToString(est_sl, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS)) + ",";
   payload += "\"tp\":" + DoubleToString(est_tp, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS));
   payload += "}";

   string resp;
   if(!GatewayRequest("validate_trade", payload, resp))
   {
      if(AI_Mode == "advisory") { size_multiplier *= 0.5; return true; }
      return false;
   }

   string decision = "", reason = "";
   double confidence = 70.0, new_mult = 1.0;
   GWExtractString(resp, "decision", decision);
   GWExtractString(resp, "reason", reason);
   GWExtractNumber(resp, "confidence", confidence);
   GWExtractNumber(resp, "size_multiplier", new_mult);

   Last_AI_Analysis = "[GW:" + dir + "] " + decision + " | " + reason;

   string u = decision;
   StringToUpper(u);

   if(StringFind(u, "YES") >= 0)
   {
      size_multiplier *= MathMax(0.1, new_mult);
      AI_Validation_Accepts++;
      return true;
   }
   if(StringFind(u, "MAYBE") >= 0)
   {
      size_multiplier *= MathMin(0.5, MathMax(0.1, new_mult));
      AI_Validation_Accepts++;
      return true;
   }
   if(StringFind(u, "NO") >= 0)
   {
      AI_Validation_Rejects++;
      return false;
   }

   // Unknown response — fall back to advisory behaviour
   if(AI_Mode == "advisory") { size_multiplier *= 0.5; return true; }
   AI_Validation_Rejects++;
   return false;
}

// ─── Multi-TF Briefing ───────────────────────────────────────────────────────

string AIFetchBriefing(const string tf_str)
{
   if(AI_Mode == "off" || !GW_Initialized)
      return "";

   string payload = "{";
   payload += "\"action\":\"get_briefing\",";
   payload += "\"symbol\":\"" + GWJsonEscape(_Symbol) + "\",";
   payload += "\"timeframe\":\"" + tf_str + "\",";
   payload += "\"price\":" + DoubleToString(iClose(_Symbol, PERIOD_CURRENT, 0), 5) + ",";
   payload += "\"session\":\"" + GWJsonEscape(GW_Session_Name) + "\"";
   payload += "}";

   string resp;
   if(!GatewayRequest("get_briefing", payload, resp))
      return "";

   string bias = "", regime = "", plan = "";
   double conf = 0.0;
   GWExtractString(resp, "bias", bias);
   GWExtractString(resp, "regime", regime);
   GWExtractString(resp, "plan", plan);
   GWExtractNumber(resp, "confidence", conf);

   return tf_str + ": " + bias + " (" + regime + ") " + DoubleToString(conf, 0) + "% — " + plan;
}

// ─── Session Briefing ────────────────────────────────────────────────────────

void AIFetchSessionBriefing()
{
   if(AI_Mode == "off" || !GW_Initialized)
      return;

   datetime now = TimeCurrent();
   MqlDateTime dt;
   TimeToStruct(now, dt);
   string server_time = StringFormat("%04d-%02d-%02d %02d:%02d",
                                     dt.year, dt.mon, dt.day, dt.hour, dt.min);

   string payload = "{";
   payload += "\"action\":\"get_session\",";
   payload += "\"symbol\":\"" + GWJsonEscape(_Symbol) + "\",";
   payload += "\"server_time\":\"" + server_time + "\",";
   payload += "\"price\":" + DoubleToString(iClose(_Symbol, PERIOD_CURRENT, 0), 5) + ",";
   payload += "\"h4_bias\":\"" + GWJsonEscape(GW_Brief_H4) + "\"";
   payload += "}";

   string resp;
   if(!GatewayRequest("get_session", payload, resp))
      return;

   GWExtractString(resp, "phase", GW_Session_Phase);
   GWExtractString(resp, "session", GW_Session_Name);
   GWExtractNumber(resp, "confidence", GW_Session_Confidence);
}

// ─── Live News Bias ──────────────────────────────────────────────────────────
//
// Enriched payload: sends actual MT5 calendar event details (name, currency,
// actual vs forecast, importance, minutes_until) so Claude can reason about
// the specific event rather than just the symbol name.

void AIFetchNewsBias()
{
   if(AI_Mode == "off" || !GW_Initialized)
      return;

   string payload = "{";
   payload += "\"action\":\"get_news_bias\",";
   payload += "\"symbol\":\"" + GWJsonEscape(_Symbol) + "\",";
   payload += "\"timeframe\":\"" + EnumToString((ENUM_TIMEFRAMES)Period()) + "\",";
   payload += "\"base_currency\":\"" + g_symbol_base + "\",";
   payload += "\"quote_currency\":\"" + g_symbol_quote + "\",";
   payload += "\"local_bias\":" + IntegerToString(News_Bias_Direction) + ",";
   payload += "\"local_strength\":" + DoubleToString(News_Bias_Strength, 2) + ",";
   payload += "\"pending_events\":" + News_Pending_Events_JSON;
   payload += "}";

   string resp;
   if(!GatewayRequest("get_news_bias", payload, resp))
      return;

   double bias_dir = 0.0, bias_str = 0.0;
   bool   block_flag = false;
   string headlines  = "";

   GWExtractNumber(resp, "bias_direction", bias_dir);
   GWExtractNumber(resp, "bias_strength",  bias_str);
   GWExtractBool(resp,   "news_block_flag", block_flag);
   GWExtractString(resp, "headlines",       headlines);

   // Override local news bias only if gateway provides a stronger signal
   if(MathAbs(bias_dir) > 0.0 && bias_str > News_Bias_Strength)
   {
      News_Bias_Direction = (int)MathRound(bias_dir);
      News_Bias_Strength  = bias_str;
   }

   if(block_flag)
      GW_News_Block_Flag = true;

   if(StringLen(headlines) > 0)
      GW_News_Headlines = headlines;
}

// ─── Trade Reporting (fire-and-forget after position close) ─────────────────

void AIReportTrade(const double profit, const string setup, const string direction, const int duration_min)
{
   if(AI_Mode == "off")
      return;

   string payload = "{";
   payload += "\"action\":\"report_trade\",";
   payload += "\"symbol\":\"" + GWJsonEscape(_Symbol) + "\",";
   payload += "\"profit\":" + DoubleToString(profit, 2) + ",";
   payload += "\"setup\":\"" + GWJsonEscape(setup) + "\",";
   payload += "\"direction\":\"" + direction + "\",";
   payload += "\"duration_min\":" + IntegerToString(duration_min);
   payload += "}";

   string resp;
   GatewayRequest("report_trade", payload, resp);  // ignore result
}

// ─── Watchlist Status ────────────────────────────────────────────────────────

bool IsSymbolActiveTrading(const string symbol)
{
   if(!Use_Watchlist_Gate || !GW_Initialized)
      return true;

   string payload = "{\"action\":\"watchlist_status\",\"symbol\":\"" + GWJsonEscape(symbol) + "\"}";
   string resp;
   if(!GatewayRequest("watchlist_status", payload, resp))
      return true;  // fail open

   bool active = true;
   GWExtractBool(resp, "active", active);
   GW_Symbol_Active = active;
   return active;
}

#endif
