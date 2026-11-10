#ifndef FIB_LEVELS_MQH
#define FIB_LEVELS_MQH

string FIB_OBJECT_PREFIX = "VZ_FIB_";
double FibHigh = 0.0;
double FibLow  = 0.0;

double PriceLevels[7];
double MFIB_Level_236 = 0.0;
double MFIB_Level_382 = 0.0;
double MFIB_Level_500 = 0.0;
double MFIB_Level_618 = 0.0;
double MFIB_Level_786 = 0.0;

void CalculateLevels()
{
   int bars = MathMax(Fib_Lookback_Bars, 120);
   int hi_index = iHighest(_Symbol, PERIOD_CURRENT, MODE_HIGH, bars, 0);
   int lo_index = iLowest(_Symbol, PERIOD_CURRENT, MODE_LOW, bars, 0);
   if(hi_index < 0 || lo_index < 0) return;

   FibHigh = iHigh(_Symbol, PERIOD_CURRENT, hi_index);
   FibLow  = iLow(_Symbol, PERIOD_CURRENT, lo_index);

   if(FibHigh <= FibLow)
      return;

   double range = FibHigh - FibLow;

   PriceLevels[0] = FibLow;
   PriceLevels[1] = FibLow + range * 0.236;
   PriceLevels[2] = FibLow + range * 0.382;
   PriceLevels[3] = FibLow + range * 0.500;
   PriceLevels[4] = FibLow + range * 0.618;
   PriceLevels[5] = FibLow + range * 0.786;
   PriceLevels[6] = FibHigh;

   // "Anchored and stacked at 0.32" around active-bias direction.
   double anchor = FibLow + range * 0.32;
   if(IsBearBias())
      anchor = FibHigh - range * 0.32;

   MFIB_Level_236 = anchor + range * 0.236 * (IsBearBias() ? -1.0 : 1.0);
   MFIB_Level_382 = anchor + range * 0.382 * (IsBearBias() ? -1.0 : 1.0);
   MFIB_Level_500 = anchor + range * 0.500 * (IsBearBias() ? -1.0 : 1.0);
   MFIB_Level_618 = anchor + range * 0.618 * (IsBearBias() ? -1.0 : 1.0);
   MFIB_Level_786 = anchor + range * 0.786 * (IsBearBias() ? -1.0 : 1.0);
}

void DrawLevels()
{
   if(FibHigh <= 0.0 || FibLow <= 0.0 || FibHigh <= FibLow)
      return;

   color fib_color = clrDodgerBlue;
   for(int i = 0; i < 7; ++i)
   {
      string name = FIB_OBJECT_PREFIX + "FIB_" + IntegerToString(i);
      if(ObjectFind(0, name) < 0)
         ObjectCreate(0, name, OBJ_HLINE, 0, 0, PriceLevels[i]);
      ObjectSetDouble(0, name, OBJPROP_PRICE, PriceLevels[i]);
      ObjectSetInteger(0, name, OBJPROP_COLOR, fib_color);
      ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_DOT);
   }

   string mname = FIB_OBJECT_PREFIX + "MFIB_032";
   if(ObjectFind(0, mname) < 0)
      ObjectCreate(0, mname, OBJ_HLINE, 0, 0, MFIB_Level_382);
   ObjectSetDouble(0, mname, OBJPROP_PRICE, MFIB_Level_382);
   ObjectSetInteger(0, mname, OBJPROP_COLOR, clrOrange);
   ObjectSetInteger(0, mname, OBJPROP_STYLE, STYLE_SOLID);
}

void CleanupLevels()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; --i)
   {
      string name = ObjectName(0, i);
      if(StringFind(name, FIB_OBJECT_PREFIX) == 0)
         ObjectDelete(0, name);
   }
}

#endif
