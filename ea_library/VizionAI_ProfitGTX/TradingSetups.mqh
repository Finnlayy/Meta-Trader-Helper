#ifndef TRADING_SETUPS_MQH
#define TRADING_SETUPS_MQH

void ExecuteReEntries();

bool IsDirectionAllowedByCoordinator(const bool buy)
{
   if(!Use_Signal_Coordinator)
      return true;

   if(!Coordinator_AllowTrade)
      return false;

   if(buy && Coordinator_Bias_Direction < 0)
      return false;

   if(!buy && Coordinator_Bias_Direction > 0)
      return false;

   return true;
}

void FireSetup(const bool buy, const string name, const bool continuation)
{
   if(!IsDirectionAllowedByCoordinator(buy))
      return;

   if(continuation)
   {
      if(Current_State != STATE_CONTINUATION && State_Bias_Confidence < 60.0)
         return;
   }

   double setup_mult = continuation ? 1.0 : 0.8;

   if(buy) OpenBuy(name, setup_mult);
   else OpenSell(name, setup_mult);
}

void ExecuteMARetestAndRejectionSetups()
{
   if(!Use_MA_Retest_Entries && !Use_MA_Rejection_Entries)
      return;

   double current = MidPrice();

   // EMA14/21/50/140/230 retests
   int watched[5] = {1,2,3,4,5};
   for(int i = 0; i < 5; ++i)
   {
      int idx = watched[i];
      double ma = MA_Current[idx];

      bool touched = NearLevel(current, ma, MA_Touch_Buffer);
      bool bull_retest = (MA_Previous[0] > MA_Previous[idx] && iLow(_Symbol, PERIOD_CURRENT, 0) <= ma && iClose(_Symbol, PERIOD_CURRENT, 0) > ma);
      bool bear_retest = (MA_Previous[0] < MA_Previous[idx] && iHigh(_Symbol, PERIOD_CURRENT, 0) >= ma && iClose(_Symbol, PERIOD_CURRENT, 0) < ma);

      if(Use_MA_Retest_Entries && touched && TimeCurrent() - Last_MA_Retest_Trade >= MA_Retest_Cooldown_Seconds)
      {
         if(bull_retest) { FireSetup(true, "EMA-RETEST-UP", true); Last_MA_Retest_Trade = TimeCurrent(); }
         if(bear_retest) { FireSetup(false, "EMA-RETEST-DN", true); Last_MA_Retest_Trade = TimeCurrent(); }
      }

      if(Use_MA_Rejection_Entries && touched && TimeCurrent() - Last_MA_Reject_Trade >= MA_Retest_Cooldown_Seconds)
      {
         double o = iOpen(_Symbol, PERIOD_CURRENT, 0);
         double c = iClose(_Symbol, PERIOD_CURRENT, 0);
         double h = iHigh(_Symbol, PERIOD_CURRENT, 0);
         double l = iLow(_Symbol, PERIOD_CURRENT, 0);
         double body = MathAbs(c - o);
         double up_wick = h - MathMax(o, c);
         double lo_wick = MathMin(o, c) - l;

         bool bull_reject = (lo_wick > body * 2.0 && c > ma);
         bool bear_reject = (up_wick > body * 2.0 && c < ma);

         if(bull_reject) { FireSetup(true, "EMA-REJECT-UP", true); Last_MA_Reject_Trade = TimeCurrent(); }
         if(bear_reject) { FireSetup(false, "EMA-REJECT-DN", true); Last_MA_Reject_Trade = TimeCurrent(); }
      }
   }
}

void ExecuteForceEntrySetups()
{
   int open_count = CountOpenTradesForSymbol();
   if(open_count >= Min_Active_Entries)
      return;

   int dir = BiasDirection();

   if(open_count < 2)
   {
      if(dir >= 0) FireSetup(true, "FORCE-URGENT-BUY", true);
      if(dir <= 0) FireSetup(false, "FORCE-URGENT-SELL", true);
      return;
   }

   if(dir >= 0 && (Active_Praise_Signals >= Active_Warnings || Current_Mode != MODE_CHOP))
      FireSetup(true, "FORCE-STANDARD-BUY", false);

   if(dir <= 0 && (Active_Warnings >= Active_Praise_Signals || Current_Mode != MODE_CHOP))
      FireSetup(false, "FORCE-STANDARD-SELL", false);
}

void ExecuteContinuationSetups()
{
   if(Current_Mode != MODE_TRENDING || Current_State != STATE_CONTINUATION)
      return;

   double current = MidPrice();
   double buffer = MA_Touch_Buffer;
   int dir = BiasDirection();

   if(MA_Previous[1] <= MA_Previous[3] && MA_Current[1] > MA_Current[3]) FireSetup(true,  "MA14-CROSS-UP",  true);
   if(MA_Previous[1] >= MA_Previous[3] && MA_Current[1] < MA_Current[3]) FireSetup(false, "MA14-CROSS-DN",  true);

   if(NearLevel(current, MA_Current[3], buffer))
   {
      if(dir >= 0) FireSetup(true, "MA50-BOUNCE-UP", true);
      if(dir <= 0) FireSetup(false, "MA50-BOUNCE-DN", true);
   }

   if(NearLevel(current, MA_Current[4], buffer))
   {
      if(dir >= 0) FireSetup(true, "MA140-BOUNCE-UP", true);
      if(dir <= 0) FireSetup(false, "MA140-BOUNCE-DN", true);
   }

   if(NearLevel(current, MA_Current[5], buffer))
   {
      if(dir >= 0) FireSetup(true, "MA230-BOUNCE-UP", true);
      if(dir <= 0) FireSetup(false, "MA230-BOUNCE-DN", true);
   }

   if(NearLevel(current, MA_Current[6], buffer))
   {
      if(dir >= 0) FireSetup(true, "MA500-TOUCH-UP", true);
      if(dir <= 0) FireSetup(false, "MA500-TOUCH-DN", true);
   }

   for(int i = 1; i <= 5; ++i)
   {
      double c0 = iClose(_Symbol, PERIOD_CURRENT, 0);
      double c1 = iClose(_Symbol, PERIOD_CURRENT, 1);
      if(c1 <= PriceLevels[i] && c0 > PriceLevels[i]) FireSetup(true, "FIB-BREAK-UP", true);
      if(c1 >= PriceLevels[i] && c0 < PriceLevels[i]) FireSetup(false, "FIB-BREAK-DN", true);
   }

   for(int i = 1; i <= 5; ++i)
   {
      double c0 = iClose(_Symbol, PERIOD_CURRENT, 0);
      double c1 = iClose(_Symbol, PERIOD_CURRENT, 1);
      if(c1 < PriceLevels[i] && c0 > PriceLevels[i]) FireSetup(true, "FIB-RECLAIM-UP", true);
      if(c1 > PriceLevels[i] && c0 < PriceLevels[i]) FireSetup(false, "FIB-RECLAIM-DN", true);
   }

   bool hugging = (Current_ATR > 0.0 && (MathAbs(current - MA_Current[2]) / Current_ATR) < 0.7);
   if(hugging && dir >= 0) FireSetup(true, "MAGNET-WALK-UP", true);
   if(hugging && dir <= 0) FireSetup(false, "MAGNET-WALK-DN", true);

   if(NearLevel(current, MFIB_Level_382, buffer) || NearLevel(current, MFIB_Level_618, buffer))
   {
      if(dir >= 0) FireSetup(true, "MFIB-LADDER-UP", true);
      if(dir <= 0) FireSetup(false, "MFIB-LADDER-DN", true);
   }
}

void ExecuteRangeSetups()
{
   if(Current_Mode != MODE_RANGING)
      return;

   double current = MidPrice();
   double buffer = MA_Touch_Buffer;

   if(NearLevel(current, PriceLevels[1], buffer) && Stoch_K_Current < Stoch_Weak_Low)
      FireSetup(true, "RANGE-EDGE-BUY", false);

   if(NearLevel(current, PriceLevels[5], buffer) && Stoch_K_Current > Stoch_Weak_High)
      FireSetup(false, "RANGE-EDGE-SELL", false);

   if(NearLevel(current, MFIB_Level_382, buffer) && Stoch_K_Current < Stoch_Mid)
      FireSetup(true, "RANGE-MFIB-BUY", false);

   if(NearLevel(current, MFIB_Level_618, buffer) && Stoch_K_Current > Stoch_Mid)
      FireSetup(false, "RANGE-MFIB-SELL", false);
}

void ExecuteChopSetups()
{
   if(Current_Mode != MODE_CHOP)
      return;

   if(Stoch_K_Current <= Stoch_Oversold && Active_Warnings >= Active_Praise_Signals)
      FireSetup(true, "CHOP-REV-BUY", false);

   if(Stoch_K_Current >= Stoch_Overbought && Active_Warnings >= Active_Praise_Signals)
      FireSetup(false, "CHOP-REV-SELL", false);

   double current = MidPrice();
   if(NearLevel(current, MA_Current[0], MA_Touch_Buffer) && Active_Warnings >= 2)
   {
      if(iClose(_Symbol, PERIOD_CURRENT, 0) < MA_Current[0]) FireSetup(true, "CHOP-SNAP-BUY", false);
      if(iClose(_Symbol, PERIOD_CURRENT, 0) > MA_Current[0]) FireSetup(false, "CHOP-SNAP-SELL", false);
   }
}

#endif
