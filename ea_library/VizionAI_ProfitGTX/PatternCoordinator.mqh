#ifndef PATTERN_COORDINATOR_MQH
#define PATTERN_COORDINATOR_MQH

bool IsNearMajorFib(const double price)
{
   return NearLevel(price, PriceLevels[1], MA_Touch_Buffer) ||
          NearLevel(price, PriceLevels[2], MA_Touch_Buffer) ||
          NearLevel(price, PriceLevels[4], MA_Touch_Buffer) ||
          NearLevel(price, PriceLevels[5], MA_Touch_Buffer);
}

void DetectFibStructureCombos()
{
   PatternComboWarn = 0;
   PatternComboPraise = 0;
   DoubleTopAtFib = false;
   DoubleBottomAtFib = false;

   if(g_SwingCount < 4)
      return;

   double tol = MA_Touch_Buffer * _Point * 1.5;

   double last_high = 0.0, prev_high = 0.0;
   double last_low = 0.0, prev_low = 0.0;
   int highs = 0, lows = 0;

   for(int i = 0; i < g_SwingCount && (highs < 2 || lows < 2); ++i)
   {
      if(g_SwingPoints[i].type == SWING_HIGH && highs < 2)
      {
         if(highs == 0) last_high = g_SwingPoints[i].price;
         else prev_high = g_SwingPoints[i].price;
         highs++;
      }

      if(g_SwingPoints[i].type == SWING_LOW && lows < 2)
      {
         if(lows == 0) last_low = g_SwingPoints[i].price;
         else prev_low = g_SwingPoints[i].price;
         lows++;
      }
   }

   if(highs >= 2 && MathAbs(last_high - prev_high) <= tol && IsNearMajorFib(last_high))
      DoubleTopAtFib = true;

   if(lows >= 2 && MathAbs(last_low - prev_low) <= tol && IsNearMajorFib(last_low))
      DoubleBottomAtFib = true;

   if(DoubleTopAtFib)
   {
      PatternComboWarn += 2;
      if(g_CurrentStructure == STRUCTURE_DOWNTREND)
         PatternComboPraise += 1;
   }

   if(DoubleBottomAtFib)
   {
      PatternComboWarn += 2;
      if(g_CurrentStructure == STRUCTURE_UPTREND)
         PatternComboPraise += 1;
   }
}

void BlendCandlesWithStructure()
{
   int rev_bull = 0, rev_bear = 0, cont_bull = 0, cont_bear = 0;

   for(int i = 0; i < g_PatternCount; ++i)
   {
      if(g_ActivePatterns[i].type == PATTERN_REVERSAL_BULLISH) rev_bull++;
      if(g_ActivePatterns[i].type == PATTERN_REVERSAL_BEARISH) rev_bear++;
      if(g_ActivePatterns[i].type == PATTERN_CONTINUATION_BULL) cont_bull++;
      if(g_ActivePatterns[i].type == PATTERN_CONTINUATION_BEAR) cont_bear++;
   }

   if(g_CurrentStructure == STRUCTURE_UPTREND)
   {
      PatternComboPraise += cont_bull;
      PatternComboWarn += rev_bear;
   }
   else if(g_CurrentStructure == STRUCTURE_DOWNTREND)
   {
      PatternComboPraise += cont_bear;
      PatternComboWarn += rev_bull;
   }
   else
   {
      PatternComboWarn += (rev_bull + rev_bear) / 2;
   }
}

void UpdatePatternCoordinator()
{
   DetectFibStructureCombos();
   BlendCandlesWithStructure();

   Active_Warnings += PatternComboWarn;
   Active_Praise_Signals += PatternComboPraise;
}

#endif
