#ifndef __AI_MQH__
#define __AI_MQH__

struct StrategyStats
{
   int wins;
   int losses;
   double score;
};

StrategyStats stats[3];

void UpdateScores()
{
   for(int i=0;i<3;i++)
   {
      int total = stats[i].wins + stats[i].losses;
      if(total>0) stats[i].score = (double)stats[i].wins/total;
      else stats[i].score = 0.0;
   }
}

bool IsValidStrategyIndex(const int strategy)
{
   return (strategy >= 0 && strategy < ArraySize(stats));
}

void RecordStrategyResult(const int strategy, const double profit)
{
   if(!IsValidStrategyIndex(strategy))
      return;

   if(profit >= 0.0)
      stats[strategy].wins++;
   else
      stats[strategy].losses++;

   UpdateScores();
}

int GetBestStrategy()
{
   int best = 0;
   double bestScore = -1.0;
   for(int i=0;i<3;i++)
   {
      if(stats[i].score > bestScore)
      {
         bestScore = stats[i].score;
         best = i;
      }
   }
   return best;
}

void UpdateAI()
{
   // placeholder: update stats periodically
   UpdateScores();
}

#endif // __AI_MQH__
