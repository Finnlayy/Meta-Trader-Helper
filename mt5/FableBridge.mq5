// FableBridge.mq5 — read-only candle publisher. No order operations.
#property strict
input string BridgeUrl = "http://127.0.0.1:3000/api/mt5";
input string BridgeToken = "";
input string MarketSymbol = ""; // Empty uses the current chart symbol.
input ENUM_TIMEFRAMES CandleTimeframe = PERIOD_M1;
input int CandleCount = 100;
input int IntervalSeconds = 5;

string PeriodName(ENUM_TIMEFRAMES p) {
   switch(p) {
      case PERIOD_M1: return "M1"; case PERIOD_M5: return "M5";
      case PERIOD_M15: return "M15"; case PERIOD_M30: return "M30";
      case PERIOD_H1: return "H1"; case PERIOD_H4: return "H4";
      case PERIOD_D1: return "D1"; case PERIOD_W1: return "W1";
      case PERIOD_MN1: return "MN1";
      default: return "";
   }
}
int OnInit() {
   if(StringLen(BridgeToken) < 32 || CandleCount < 1 || CandleCount > 500 || IntervalSeconds < 1 || PeriodName(CandleTimeframe) == "") {
      Print("Bridge configuration invalid. Check token, count, interval and timeframe."); return INIT_PARAMETERS_INCORRECT;
   }
   EventSetTimer(IntervalSeconds);
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer() {
   string symbol = MarketSymbol == "" ? _Symbol : MarketSymbol;
   MqlRates rates[];
   int count = CopyRates(symbol, CandleTimeframe, 0, CandleCount, rates);
   if(count <= 0) { Print("CopyRates failed: ", GetLastError()); return; }
   // MT5 symbol names are validated rather than interpolated without JSON escaping.
   for(int j = 0; j < StringLen(symbol); j++) {
      ushort c = StringGetCharacter(symbol, j);
      if(!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '#' || c == '-')) {
         Print("Unsupported symbol character"); return;
      }
   }
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   string body = "{\"symbol\":\"" + symbol + "\",\"timeframe\":\"" + PeriodName(CandleTimeframe) + "\",\"candles\":[";
   for(int i = 0; i < count; i++) {
      if(i > 0) body += ",";
      body += "{\"time\":" + IntegerToString((long)rates[i].time) + ",\"open\":" + DoubleToString(rates[i].open, digits) + ",\"high\":" + DoubleToString(rates[i].high, digits) + ",\"low\":" + DoubleToString(rates[i].low, digits) + ",\"close\":" + DoubleToString(rates[i].close, digits) + ",\"tickVolume\":" + IntegerToString(rates[i].tick_volume) + "}";
   }
   body += "]}";
   char data[], result[]; string responseHeaders;
   int size = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(size > 0) ArrayResize(data, size - 1);
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + BridgeToken + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", BridgeUrl, headers, 5000, data, result, responseHeaders);
   if(code != 200) Print("Bridge request failed: HTTP ", code, ", MT5 error ", GetLastError());
}
