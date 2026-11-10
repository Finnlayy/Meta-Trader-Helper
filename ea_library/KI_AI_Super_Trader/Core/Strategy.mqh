#ifndef __STRATEGY_MQH__
#define __STRATEGY_MQH__

#include "Regime.mqh"
#include "AI.mqh"

#define STRAT_TREND 0
#define STRAT_MEAN 1
#define STRAT_BREAKOUT 2

int GetStrategyForRegime(MarketRegime regime)
{
   switch(regime)
   {
      case REGIME_TREND: return STRAT_TREND;
      case REGIME_RANGE: return STRAT_MEAN;
      case REGIME_HIGH_VOL: return STRAT_BREAKOUT;
      default: return STRAT_MEAN;
   }
}

int GetFinalStrategy()
{
   int regimeStrat = GetStrategyForRegime(currentRegime);
   int bestAI = GetBestStrategy();

   if(stats[bestAI].score > stats[regimeStrat].score)
      return bestAI;

   return regimeStrat;
}

#endif // __STRATEGY_MQH__
