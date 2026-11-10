#ifndef __REGIME_MQH__
#define __REGIME_MQH__

enum MarketRegime
{
   REGIME_TREND = 0,
   REGIME_RANGE = 1,
   REGIME_HIGH_VOL = 2,
   REGIME_LOW_VOL = 3
};

MarketRegime currentRegime = REGIME_RANGE;

// Cached indicator handles per symbol/timeframe for low overhead in OnTick.
string          g_regimeSymbol = "";
ENUM_TIMEFRAMES g_regimeTF     = PERIOD_CURRENT;
int             g_regimeFastEmaHandle = INVALID_HANDLE;
int             g_regimeSlowEmaHandle = INVALID_HANDLE;
int             g_regimeAtrHandle     = INVALID_HANDLE;

void RegimeReleaseHandles()
{
   if(g_regimeFastEmaHandle != INVALID_HANDLE)
   {
      IndicatorRelease(g_regimeFastEmaHandle);
      g_regimeFastEmaHandle = INVALID_HANDLE;
   }
   if(g_regimeSlowEmaHandle != INVALID_HANDLE)
   {
      IndicatorRelease(g_regimeSlowEmaHandle);
      g_regimeSlowEmaHandle = INVALID_HANDLE;
   }
   if(g_regimeAtrHandle != INVALID_HANDLE)
   {
      IndicatorRelease(g_regimeAtrHandle);
      g_regimeAtrHandle = INVALID_HANDLE;
   }
}

bool RegimeEnsureHandles(const string symbol, const ENUM_TIMEFRAMES tf)
{
   if(symbol == g_regimeSymbol &&
      tf == g_regimeTF &&
      g_regimeFastEmaHandle != INVALID_HANDLE &&
      g_regimeSlowEmaHandle != INVALID_HANDLE &&
      g_regimeAtrHandle != INVALID_HANDLE)
   {
      return true;
   }

   RegimeReleaseHandles();

   g_regimeFastEmaHandle = iMA(symbol, tf, 50, 0, MODE_EMA, PRICE_CLOSE);
   g_regimeSlowEmaHandle = iMA(symbol, tf, 200, 0, MODE_EMA, PRICE_CLOSE);
   g_regimeAtrHandle     = iATR(symbol, tf, 14);

   if(g_regimeFastEmaHandle == INVALID_HANDLE ||
      g_regimeSlowEmaHandle == INVALID_HANDLE ||
      g_regimeAtrHandle == INVALID_HANDLE)
   {
      return false;
   }

   g_regimeSymbol = symbol;
   g_regimeTF     = tf;
   return true;
}

MarketRegime DetectMarket(const ENUM_TIMEFRAMES tfIn)
{
   ENUM_TIMEFRAMES tf = tfIn;
   if(tf <= 0)
      tf = PERIOD_M5;

   if(!RegimeEnsureHandles(_Symbol, tf))
      return REGIME_RANGE;

   double emaFast[1];
   double emaSlow[1];
   double atr[1];
   if(CopyBuffer(g_regimeFastEmaHandle, 0, 0, 1, emaFast) < 1) return REGIME_RANGE;
   if(CopyBuffer(g_regimeSlowEmaHandle, 0, 0, 1, emaSlow) < 1) return REGIME_RANGE;
   if(CopyBuffer(g_regimeAtrHandle, 0, 0, 1, atr) < 1) return REGIME_RANGE;

   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   if(point <= 0.0)
      point = 0.00001;

   double emaDeltaPts = MathAbs(emaFast[0] - emaSlow[0]) / point;
   double atrPts      = atr[0] / point;

   // Conservative thresholds to avoid false regime switching.
   if(emaDeltaPts >= 180.0)
      return REGIME_TREND;

   if(atrPts >= 220.0)
      return REGIME_HIGH_VOL;

   if(atrPts <= 70.0)
      return REGIME_LOW_VOL;

   return REGIME_RANGE;
}

#endif // __REGIME_MQH__
