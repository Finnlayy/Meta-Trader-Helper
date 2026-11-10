#ifndef WARNINGS_MQH
#define WARNINGS_MQH

void ResetWarningFlags()
{
   MA7_Cross_14_Warning = false;
   MA7_Cross_21_Warning = false;
   MA50_Break_Warning = false;
   Fib_Reject_Warning = false;
   MFIB_Reject_Warning = false;
   Fib_Reclaim_Warning = false;
   MFIB_Reclaim_Warning = false;
   Fib_Break_Warning = false;
   MFIB_Break_Warning = false;
   MA_Reject_Warning = false;
   MA_Reclaim_Warning = false;
   MA_Break_Warning = false;
   Stoch_Extreme_Warning = false;
   Stoch_Reject_Warning = false;
   Stoch_Level_Cross = false;
   MA50_Warning = false;
   MA140_Warning = false;
   MA230_Warning = false;
   MA500_Warning = false;
   Pullback_Warning = false;
   Retracement_Warning = false;
   Band_Snap_Warning = false;
   MA14_Magnet_Active = false;
   Fib_Break_Confirmed = false;
   MFIB_Break_Confirmed = false;
   Strong_MA_Bounce = false;
   Trend_Resumption = false;
}

void AddDirectionalScore(const bool bullish_event)
{
   int dir = BiasDirection();
   if(dir == 0)
   {
      Active_Warnings++;
      return;
   }

   if((dir > 0 && bullish_event) || (dir < 0 && !bullish_event))
      Active_Praise_Signals++;
   else
      Active_Warnings++;
}

void DetectWarnings()
{
   Active_Warnings = 0;
   Active_Praise_Signals = 0;
   ResetWarningFlags();

   double current = MidPrice();
   double prev = iClose(_Symbol, PERIOD_CURRENT, 1);

   // Stoch core logic.
   if(Stoch_K_Current <= Stoch_Oversold || Stoch_K_Current >= Stoch_Overbought)
      Stoch_Extreme_Warning = true;

   bool cross_up = (Stoch_K_Previous <= Stoch_D_Current && Stoch_K_Current > Stoch_D_Current);
   bool cross_dn = (Stoch_K_Previous >= Stoch_D_Current && Stoch_K_Current < Stoch_D_Current);
   if(cross_up || cross_dn)
      Stoch_Level_Cross = true;

   if((cross_dn && Stoch_K_Current > Stoch_Mid) || (cross_up && Stoch_K_Current < Stoch_Mid))
      Stoch_Reject_Warning = true;

   if(Stoch_Extreme_Warning) Active_Warnings++;

   // MA crosses and strong MA touches.
   MA7_Cross_14_Warning = ((MA_Previous[0] > MA_Previous[1] && MA_Current[0] <= MA_Current[1]) ||
                           (MA_Previous[0] < MA_Previous[1] && MA_Current[0] >= MA_Current[1]));
   MA7_Cross_21_Warning = ((MA_Previous[0] > MA_Previous[2] && MA_Current[0] <= MA_Current[2]) ||
                           (MA_Previous[0] < MA_Previous[2] && MA_Current[0] >= MA_Current[2]));
   MA50_Break_Warning = ((MA_Previous[0] > MA_Previous[3] && MA_Current[0] <= MA_Current[3]) ||
                         (MA_Previous[0] < MA_Previous[3] && MA_Current[0] >= MA_Current[3]));

   double b = MA_Touch_Buffer;
   MA50_Warning = NearLevel(current, MA_Current[3], b);
   MA140_Warning = NearLevel(current, MA_Current[4], b);
   MA230_Warning = NearLevel(current, MA_Current[5], b);
   MA500_Warning = NearLevel(current, MA_Current[6], b);

   MA_Reject_Warning = (MA50_Warning || MA140_Warning || MA230_Warning || MA500_Warning) && (Stoch_Reject_Warning || Stoch_Level_Cross);
   MA_Reclaim_Warning = MA50_Break_Warning || MA7_Cross_14_Warning;
   MA_Break_Warning = MA7_Cross_21_Warning || MA50_Break_Warning;

   Pullback_Warning = MA7_Cross_14_Warning || MA_Reject_Warning;
   Retracement_Warning = MA7_Cross_21_Warning || MA50_Break_Warning;

   if(Current_ATR > 0.0 && MathAbs(current - MA_Current[0]) > Current_ATR * 1.5)
      Band_Snap_Warning = true;

   // Fib and MFib combos: break/reject/reclaim/break+retest
   for(int i = 1; i <= 5; ++i)
   {
      double lv = PriceLevels[i];
      bool break_up = (prev <= lv && current > lv);
      bool break_dn = (prev >= lv && current < lv);
      bool reject_up = (iLow(_Symbol, PERIOD_CURRENT, 0) <= lv && current > lv);
      bool reject_dn = (iHigh(_Symbol, PERIOD_CURRENT, 0) >= lv && current < lv);
      bool reclaim_up = (prev < lv && current > lv);
      bool reclaim_dn = (prev > lv && current < lv);
      bool retest_up = (prev > lv && NearLevel(iLow(_Symbol, PERIOD_CURRENT, 0), lv, b));
      bool retest_dn = (prev < lv && NearLevel(iHigh(_Symbol, PERIOD_CURRENT, 0), lv, b));

      if(break_up) { Fib_Break_Warning = true; AddDirectionalScore(true); }
      if(break_dn) { Fib_Break_Warning = true; AddDirectionalScore(false); }
      if(reject_up) { Fib_Reject_Warning = true; AddDirectionalScore(true); }
      if(reject_dn) { Fib_Reject_Warning = true; AddDirectionalScore(false); }
      if(reclaim_up) { Fib_Reclaim_Warning = true; AddDirectionalScore(true); }
      if(reclaim_dn) { Fib_Reclaim_Warning = true; AddDirectionalScore(false); }
      if(retest_up) AddDirectionalScore(true);
      if(retest_dn) AddDirectionalScore(false);
   }

   double mfib[5] = {MFIB_Level_236, MFIB_Level_382, MFIB_Level_500, MFIB_Level_618, MFIB_Level_786};
   for(int i = 0; i < 5; ++i)
   {
      double lv = mfib[i];
      bool break_up = (prev <= lv && current > lv);
      bool break_dn = (prev >= lv && current < lv);
      bool reject_up = (iLow(_Symbol, PERIOD_CURRENT, 0) <= lv && current > lv);
      bool reject_dn = (iHigh(_Symbol, PERIOD_CURRENT, 0) >= lv && current < lv);

      if(break_up) { MFIB_Break_Warning = true; MFIB_Break_Confirmed = true; AddDirectionalScore(true); }
      if(break_dn) { MFIB_Break_Warning = true; MFIB_Break_Confirmed = true; AddDirectionalScore(false); }
      if(reject_up) { MFIB_Reject_Warning = true; AddDirectionalScore(true); }
      if(reject_dn) { MFIB_Reject_Warning = true; AddDirectionalScore(false); }

      if((prev < lv && current > lv) || (prev > lv && current < lv))
      {
         MFIB_Reclaim_Warning = true;
         AddDirectionalScore(current > lv);
      }
   }

   MA14_Magnet_Active = (Current_ATR > 0.0 && (MathAbs(current - MA_Current[1]) / Current_ATR) < 0.7);
   Strong_MA_Bounce = (MA140_Warning || MA230_Warning || MA500_Warning) && Stoch_Level_Cross;
   Trend_Resumption = (IsBullBias() || IsBearBias()) && !Band_Snap_Warning;

   Warning_Confluence_Count = 0;
   if(MA7_Cross_14_Warning) Warning_Confluence_Count++;
   if(MA7_Cross_21_Warning) Warning_Confluence_Count++;
   if(MA50_Break_Warning) Warning_Confluence_Count++;
   if(Stoch_Extreme_Warning) Warning_Confluence_Count++;
   if(Stoch_Reject_Warning) Warning_Confluence_Count++;
   if(Stoch_Level_Cross) Warning_Confluence_Count++;
   if(Fib_Reject_Warning) Warning_Confluence_Count++;
   if(MFIB_Reject_Warning) Warning_Confluence_Count++;
   if(MA_Reject_Warning) Warning_Confluence_Count++;
   if(Band_Snap_Warning) Warning_Confluence_Count++;

   Warning_Confluence_3Plus = (Warning_Confluence_Count >= 3);

   double spread_points = (SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID)) / _Point;
   if(spread_points > 30.0)
      Active_Warnings++;
}

#endif
