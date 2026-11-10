#ifndef PRAISE_MQH
#define PRAISE_MQH

void DetectPraiseSignals()
{
   Praise_Triple_Magnet = false;
   Praise_Power_Couple = false;
   Praise_MFIB_Staircase = false;
   Praise_MFIB_Express = false;
   Praise_MFIB_Breakout = false;
   Praise_MA_Stack = false;
   Praise_Clean_Reclaim = false;
   Praise_Multi_Breakout = false;

   double current = MidPrice();

   // 1) 7/14/21 Triple magnet hold.
   if(Current_ATR > 0.0)
   {
      double d7 = MathAbs(current - MA_Current[0]) / Current_ATR;
      double d14 = MathAbs(current - MA_Current[1]) / Current_ATR;
      double d21 = MathAbs(current - MA_Current[2]) / Current_ATR;
      if(d7 < 0.5 && d14 < 0.7 && d21 < 0.9 && !Band_Snap_Warning)
         Praise_Triple_Magnet = true;
   }

   // 2) 14/21 power couple.
   if(Current_ATR > 0.0 && (MathAbs(MA_Current[1] - MA_Current[2]) / Current_ATR) < 0.3)
      Praise_Power_Couple = true;

   // 3) MFIB staircase.
   if((NearLevel(current, MFIB_Level_382, MA_Touch_Buffer) || NearLevel(current, MFIB_Level_618, MA_Touch_Buffer)) && !MFIB_Reject_Warning)
      Praise_MFIB_Staircase = true;

   // 4) MFIB express.
   if(Current_ADX > 25.0 && (MathAbs(MFIB_Level_786 - MFIB_Level_382) / _Point) > 100)
      Praise_MFIB_Express = true;

   // 5) MFIB breakout hold.
   if(MFIB_Break_Confirmed && !MFIB_Reject_Warning)
      Praise_MFIB_Breakout = true;

   // 6) MA stack perfection.
   bool stack_bull = (MA_Current[0] > MA_Current[1] && MA_Current[1] > MA_Current[2] && MA_Current[2] > MA_Current[3] && MA_Current[3] > MA_Current[4]);
   bool stack_bear = (MA_Current[0] < MA_Current[1] && MA_Current[1] < MA_Current[2] && MA_Current[2] < MA_Current[3] && MA_Current[3] < MA_Current[4]);
   if(stack_bull || stack_bear)
      Praise_MA_Stack = true;

   // 7) Clean reclaim sequence.
   if(MFIB_Reclaim_Warning && MA_Reclaim_Warning && Fib_Reclaim_Warning)
      Praise_Clean_Reclaim = true;

   // 8) Multi-level breakout.
   if(MFIB_Break_Confirmed && Fib_Break_Confirmed && MA_Break_Warning)
      Praise_Multi_Breakout = true;

   Praise_Count = 0;
   if(Praise_Triple_Magnet) Praise_Count++;
   if(Praise_Power_Couple) Praise_Count++;
   if(Praise_MFIB_Staircase) Praise_Count++;
   if(Praise_MFIB_Express) Praise_Count++;
   if(Praise_MFIB_Breakout) Praise_Count++;
   if(Praise_MA_Stack) Praise_Count++;
   if(Praise_Clean_Reclaim) Praise_Count++;
   if(Praise_Multi_Breakout) Praise_Count++;

   // Bridge into existing orchestrator counters.
   Active_Praise_Signals += Praise_Count;
}

#endif
