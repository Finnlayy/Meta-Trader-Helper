#ifndef MARKET_STATE_MQH
#define MARKET_STATE_MQH

void UpdateModeAndState()
{
   bool stack_bull = (MA_Current[0] > MA_Current[1] && MA_Current[1] > MA_Current[2] && MA_Current[2] > MA_Current[3]);
   bool stack_bear = (MA_Current[0] < MA_Current[1] && MA_Current[1] < MA_Current[2] && MA_Current[2] < MA_Current[3]);

   double ma_gap_points = MathAbs(MA_Current[0] - MA_Current[3]) / _Point;
   bool low_trend_energy = (Current_ADX < 16.0 || ma_gap_points < 80.0);

   if((stack_bull || stack_bear) && Current_ADX >= 20.0)
      Current_Mode = MODE_TRENDING;
   else if(low_trend_energy)
      Current_Mode = MODE_CHOP;
   else
      Current_Mode = MODE_RANGING;

   if(Active_Praise_Signals >= Active_Warnings + 2)
      Current_State = STATE_CONTINUATION;
   else if(Active_Warnings >= Active_Praise_Signals + 2)
      Current_State = STATE_REVERSAL;
   else
      Current_State = STATE_PULLBACK;

   // State bias for downstream execution gating.
   Current_Bias_Direction = BiasDirection();

   double raw = 50.0 + (double)(Active_Praise_Signals - Active_Warnings) * 5.0;
   if(Current_Mode == MODE_TRENDING) raw += 10.0;
   if(Current_Mode == MODE_CHOP) raw -= 10.0;
   State_Bias_Confidence = MathMax(0.0, MathMin(100.0, raw));
}

#endif
