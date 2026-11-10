#ifndef UTILITIES_MQH
#define UTILITIES_MQH

string ModeToString(const int mode)
{
   if(mode == MODE_TRENDING) return "TRENDING";
   if(mode == MODE_RANGING)  return "RANGING";
   return "CHOP";
}

string StateToString(const int state)
{
   if(state == STATE_CONTINUATION) return "CONTINUATION";
   if(state == STATE_REVERSAL)     return "REVERSAL";
   return "PULLBACK";
}

double MidPrice()
{
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   return (bid + ask) * 0.5;
}

bool NearLevel(const double price, const double level, const double tolPoints)
{
   return (MathAbs(price - level) <= tolPoints * _Point);
}

bool StochCrossUp()
{
   return (Stoch_K_Previous < Stoch_D_Current && Stoch_K_Current >= Stoch_D_Current);
}

bool StochCrossDown()
{
   return (Stoch_K_Previous > Stoch_D_Current && Stoch_K_Current <= Stoch_D_Current);
}

bool Bull_MA50_Reclaimed()
{
   bool reclaimed = (MA_Previous[0] <= MA_Previous[3]) && (MA_Current[0] > MA_Current[3]);
   double low0 = iLow(_Symbol, PERIOD_CURRENT, 0);
   double close0 = iClose(_Symbol, PERIOD_CURRENT, 0);
   bool rejected = (low0 <= MA_Current[3] && close0 > MA_Current[3] && (StochCrossUp() || Stoch_K_Current > 50));
   return (reclaimed || rejected);
}

bool Bear_MA50_Reclaimed()
{
   bool reclaimed = (MA_Previous[0] >= MA_Previous[3]) && (MA_Current[0] < MA_Current[3]);
   double high0 = iHigh(_Symbol, PERIOD_CURRENT, 0);
   double close0 = iClose(_Symbol, PERIOD_CURRENT, 0);
   bool rejected = (high0 >= MA_Current[3] && close0 < MA_Current[3] && (StochCrossDown() || Stoch_K_Current < 50));
   return (reclaimed || rejected);
}

void ApplySymbolProfile()
{
   // MQL5 StringToUpper mutates its argument.
   string s = _Symbol;
   StringToUpper(s);

   Symbol_Profile_Name = "MANUAL";
   Symbol_SL_Points = Manual_SL_Points;
   Symbol_TP_Points = Manual_TP_Points;

   if(!Use_Auto_Symbol_Config)
   {
      Symbol_Profile_Initialized = true;
      return;
   }

   if(StringFind(s, "XAU") >= 0)
   {
      Symbol_Profile_Name = "XAUUSD";
      Symbol_SL_Points = 500;
      Symbol_TP_Points = 3500;
   }
   else if(StringFind(s, "US30") >= 0 || StringFind(s, "DJI") >= 0)
   {
      Symbol_Profile_Name = "US30";
      Symbol_SL_Points = 150;
      Symbol_TP_Points = 1000;
   }
   else if(StringFind(s, "NAS100") >= 0 || StringFind(s, "USTEC") >= 0)
   {
      Symbol_Profile_Name = "NAS100";
      Symbol_SL_Points = 200;
      Symbol_TP_Points = 1400;
   }
   else if(StringFind(s, "USOIL") >= 0 || StringFind(s, "WTI") >= 0)
   {
      Symbol_Profile_Name = "USOIL";
      Symbol_SL_Points = 80;
      Symbol_TP_Points = 600;
   }
   else if(StringFind(s, "BTC") >= 0 || StringFind(s, "ETH") >= 0)
   {
      Symbol_Profile_Name = "CRYPTO";
      Symbol_SL_Points = 800;
      Symbol_TP_Points = 6000;
   }
   else if(StringFind(s, "JPY") >= 0)
   {
      Symbol_Profile_Name = "JPY";
      Symbol_SL_Points = 60;
      Symbol_TP_Points = 450;
   }
   else if(StringFind(s, "CAD") >= 0)
   {
      Symbol_Profile_Name = "COMMODITY_FX";
      Symbol_SL_Points = 40;
      Symbol_TP_Points = 300;
   }
   else
   {
      Symbol_Profile_Name = "MAJOR_FX";
      Symbol_SL_Points = 50;
      Symbol_TP_Points = 350;
   }

   Symbol_Profile_Initialized = true;
}

string FamilyToText(const int mode)
{
   if(mode == MODE_TRENDING) return "Trending";
   if(mode == MODE_RANGING) return "Ranging";
   if(mode == MODE_CHOP) return "Chop";
   return "Unknown";
}

string BiasToText(const int bias)
{
   if(bias > 0) return "Bull";
   if(bias < 0) return "Bear";
   return "Neutral";
}

string StrengthToText(const double conf)
{
   if(conf >= 70.0) return "Strong";
   if(conf >= 55.0) return "Confirmed";
   return "Weak";
}

double NormalizePrice(const double price)
{
   return NormalizeDouble(price, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS));
}

double NormalizeLots(double lots)
{
   double min_lot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double max_lot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lot_step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   if(lot_step <= 0.0) lot_step = 0.01;
   lots = MathMax(min_lot, MathMin(max_lot, lots));
   lots = MathFloor(lots / lot_step) * lot_step;
   return NormalizeDouble(lots, 2);
}

#endif
