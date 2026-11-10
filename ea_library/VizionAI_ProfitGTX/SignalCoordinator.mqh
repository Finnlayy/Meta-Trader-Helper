#ifndef SIGNAL_COORDINATOR_MQH
#define SIGNAL_COORDINATOR_MQH

#include "CandlePatterns.mqh"
#include "NNDataLogger.mqh"

struct CoordinatedSignal
{
   string   source;
   string   action;
   string   direction;
   string   signal_type;
   double   strength;
   string   location;
   datetime timestamp;
   double   price;
   bool     at_key_level;
};

struct SignalCluster
{
   CoordinatedSignal signals[20];
   int               count;
   string            consensus_direction;
   string            consensus_type;
   double            combined_strength;
   double            conflict_score;
   datetime          cluster_time;
};

CoordinatedSignal SignalHistory[100];
int               SignalHistoryCount = 0;
SignalCluster     CurrentCluster;

void InitializeSignalCoordinator()
{
   SignalHistoryCount = 0;
   CurrentCluster.count = 0;
   CurrentCluster.consensus_direction = "neutral";
   CurrentCluster.consensus_type = "";
   CurrentCluster.combined_strength = 0.0;
   CurrentCluster.conflict_score = 100.0;

   BullWarnCount = 0;
   BullPraiseCount = 0;
   BearWarnCount = 0;
   BearPraiseCount = 0;

   Coordinator_Bias_Direction = 0;
   Coordinator_Cluster_Strength = 0.0;
   Coordinator_Conflict_Score = 100.0;
   Coordinator_Lot_Multiplier = 1.0;
   Coordinator_AllowTrade = false;
}

void ResetSignalCluster()
{
   CurrentCluster.count = 0;
   CurrentCluster.consensus_direction = "neutral";
   CurrentCluster.consensus_type = "";
   CurrentCluster.combined_strength = 0.0;
   CurrentCluster.conflict_score = 0.0;
}

bool HasConflict(CoordinatedSignal &new_signal)
{
   datetime now = TimeCurrent();
   int lookback = MathMin(SignalHistoryCount, 20);

   for(int i = SignalHistoryCount - 1; i >= SignalHistoryCount - lookback && i >= 0; --i)
   {
      if(now - SignalHistory[i].timestamp > Conflict_Prevention_Seconds)
         break;

      if(SignalHistory[i].source == new_signal.source && now - SignalHistory[i].timestamp < 60)
         return true;

      if(SignalHistory[i].direction != new_signal.direction &&
         SignalHistory[i].strength >= 70.0 && new_signal.strength >= 70.0)
         return true;
   }

   return false;
}

void UpdateBalanceCounters(const CoordinatedSignal &signal)
{
   if(signal.direction == "bullish" && signal.signal_type == "WARN") BullWarnCount++;
   if(signal.direction == "bullish" && signal.signal_type == "PRAISE") BullPraiseCount++;
   if(signal.direction == "bearish" && signal.signal_type == "WARN") BearWarnCount++;
   if(signal.direction == "bearish" && signal.signal_type == "PRAISE") BearPraiseCount++;
}

bool AddCoordinatedSignal(const string source,
                         const string action,
                         const string direction,
                         const string signal_type,
                         const double strength,
                         const string location,
                         const double price,
                         const bool at_key_level)
{
   CoordinatedSignal signal;
   signal.source = source;
   signal.action = action;
   signal.direction = direction;
   signal.signal_type = signal_type;
   signal.strength = strength;
   signal.location = location;
   signal.timestamp = TimeCurrent();
   signal.price = price;
   signal.at_key_level = at_key_level;

   if(HasConflict(signal))
      return false;

   if(SignalHistoryCount < ArraySize(SignalHistory))
      SignalHistory[SignalHistoryCount++] = signal;

   if(CurrentCluster.count < ArraySize(CurrentCluster.signals))
      CurrentCluster.signals[CurrentCluster.count++] = signal;

   UpdateBalanceCounters(signal);
   return true;
}

void GenerateMASignals()
{
   double p = MidPrice();

   if(p > MA_Current[2]) AddCoordinatedSignal("ma", "reclaim", "bullish", "PRAISE", 65, "ma21", p, false);
   if(p < MA_Current[2]) AddCoordinatedSignal("ma", "break", "bearish", "PRAISE", 65, "ma21", p, false);

   if(NearLevel(p, MA_Current[3], MA_Touch_Buffer))
   {
      if(iClose(_Symbol, PERIOD_CURRENT, 0) > MA_Current[3])
         AddCoordinatedSignal("ma", "reclaim", "bullish", "WARN", 70, "ma50", MA_Current[3], true);
      else
         AddCoordinatedSignal("ma", "reject", "bearish", "WARN", 70, "ma50", MA_Current[3], true);
   }

   if(p > MA_Current[4]) AddCoordinatedSignal("ma", "reclaim", "bullish", "PRAISE", 75, "ma140", p, true);
   if(p < MA_Current[4]) AddCoordinatedSignal("ma", "break", "bearish", "PRAISE", 75, "ma140", p, true);
}

void GenerateMFIBSignals()
{
   double p = MidPrice();
   static double prev = 0.0;
   if(prev == 0.0) prev = p;

   double lv[4] = {MFIB_Level_236, MFIB_Level_382, MFIB_Level_618, MFIB_Level_786};
   string nm[4] = {"mfib236","mfib382","mfib618","mfib786"};

   for(int i = 0; i < 4; ++i)
   {
      if(!NearLevel(p, lv[i], 50)) continue;

      bool support = (i < 2);
      if(support)
      {
         if(prev < lv[i] && p >= lv[i]) AddCoordinatedSignal("mfib", "reclaim", "bullish", "PRAISE", 85, nm[i], lv[i], true);
         else AddCoordinatedSignal("mfib", "reject", "bullish", "WARN", 90, nm[i], lv[i], true);
      }
      else
      {
         if(prev > lv[i] && p <= lv[i]) AddCoordinatedSignal("mfib", "break", "bearish", "PRAISE", 85, nm[i], lv[i], true);
         else AddCoordinatedSignal("mfib", "reject", "bearish", "WARN", 90, nm[i], lv[i], true);
      }
   }

   prev = p;
}

void GenerateFIBSignals()
{
   double p = MidPrice();
   static double prev = 0.0;
   if(prev == 0.0) prev = p;

   if(NearLevel(p, PriceLevels[1], 50))
   {
      if(prev < PriceLevels[1] && p >= PriceLevels[1])
         AddCoordinatedSignal("fib", "reclaim", "bullish", "PRAISE", 75, "fib236", PriceLevels[1], true);
      else
         AddCoordinatedSignal("fib", "reject", "bullish", "WARN", 80, "fib236", PriceLevels[1], true);
   }

   if(NearLevel(p, PriceLevels[4], 50))
   {
      if(prev > PriceLevels[4] && p <= PriceLevels[4])
         AddCoordinatedSignal("fib", "break", "bearish", "PRAISE", 75, "fib618", PriceLevels[4], true);
      else
         AddCoordinatedSignal("fib", "reject", "bearish", "WARN", 80, "fib618", PriceLevels[4], true);
   }

   prev = p;
}

void GenerateStochSignals()
{
   if(Stoch_K_Current < Stoch_Oversold)
      AddCoordinatedSignal("stoch", "reject", "bullish", "WARN", 70, "oversold", Stoch_K_Current, false);

   if(Stoch_K_Current > Stoch_Overbought)
      AddCoordinatedSignal("stoch", "reject", "bearish", "WARN", 70, "overbought", Stoch_K_Current, false);

   if(Stoch_K_Current > Stoch_D_Current && Stoch_K_Current > 30 && Stoch_K_Current < 50)
      AddCoordinatedSignal("stoch", "reclaim", "bullish", "PRAISE", 65, "mid", Stoch_K_Current, false);

   if(Stoch_K_Current < Stoch_D_Current && Stoch_K_Current < 70 && Stoch_K_Current > 50)
      AddCoordinatedSignal("stoch", "break", "bearish", "PRAISE", 65, "mid", Stoch_K_Current, false);
}

void GenerateCandleSignals()
{
   for(int i = 0; i < g_PatternCount; ++i)
   {
      string direction = "";
      string action = "";
      string type = "WARN";

      if(g_ActivePatterns[i].type == PATTERN_REVERSAL_BULLISH) { direction = "bullish"; action = "reject"; type = "WARN"; }
      if(g_ActivePatterns[i].type == PATTERN_REVERSAL_BEARISH) { direction = "bearish"; action = "reject"; type = "WARN"; }
      if(g_ActivePatterns[i].type == PATTERN_CONTINUATION_BULL) { direction = "bullish"; action = "reclaim"; type = "PRAISE"; }
      if(g_ActivePatterns[i].type == PATTERN_CONTINUATION_BEAR) { direction = "bearish"; action = "break"; type = "PRAISE"; }

      if(direction != "")
         AddCoordinatedSignal("candle", action, direction, type,
                              g_ActivePatterns[i].adjusted_strength,
                              g_ActivePatterns[i].name_str,
                              g_ActivePatterns[i].pattern_price,
                              false);
   }
}

void BuildSignalCluster()
{
   if(CurrentCluster.count == 0)
   {
      CurrentCluster.consensus_direction = "neutral";
      CurrentCluster.consensus_type = "";
      CurrentCluster.combined_strength = 0;
      CurrentCluster.conflict_score = 100;
      return;
   }

   int bull = 0, bear = 0, warn = 0, praise = 0;
   double total = 0.0;

   for(int i = 0; i < CurrentCluster.count; ++i)
   {
      if(CurrentCluster.signals[i].direction == "bullish") bull++;
      if(CurrentCluster.signals[i].direction == "bearish") bear++;
      if(CurrentCluster.signals[i].signal_type == "WARN") warn++;
      if(CurrentCluster.signals[i].signal_type == "PRAISE") praise++;
      total += CurrentCluster.signals[i].strength;
   }

   double bull_pct = (double)bull / (double)CurrentCluster.count;
   double bear_pct = (double)bear / (double)CurrentCluster.count;

   if(bull_pct >= Signal_Consensus_Threshold) CurrentCluster.consensus_direction = "bullish";
   else if(bear_pct >= Signal_Consensus_Threshold) CurrentCluster.consensus_direction = "bearish";
   else CurrentCluster.consensus_direction = "neutral";

   CurrentCluster.consensus_type = (warn > praise) ? "WARN" : "PRAISE";
   CurrentCluster.combined_strength = total / (double)CurrentCluster.count;

   int min_dir = MathMin(bull, bear);
   int min_type = MathMin(warn, praise);
   double dir_conflict = (double)min_dir / (double)CurrentCluster.count;
   double type_conflict = (double)min_type / (double)CurrentCluster.count;
   CurrentCluster.conflict_score = ((dir_conflict * 0.7) + (type_conflict * 0.3)) * 100.0;
   CurrentCluster.cluster_time = TimeCurrent();
}

bool ShouldTradeFromCluster(SignalCluster &cluster, double &multiplier)
{
   // Hard news block (high-impact event with no clear direction)
   if(News_Trade_Block_Active)
      return false;

   // News directional gate — filter cluster direction against allowed news direction
   if(News_Trade_Allowed_Direction == 1 && cluster.consensus_direction == "bearish")
      return false;
   if(News_Trade_Allowed_Direction == -1 && cluster.consensus_direction == "bullish")
      return false;

   if(cluster.conflict_score > Max_Cluster_Conflict)
      return false;

   if(cluster.consensus_direction == "neutral")
      return false;

   if(cluster.combined_strength < Min_Cluster_Strength)
      return false;

   if(TimeCurrent() - Last_Trade_Time < Conflict_Prevention_Seconds &&
      LastTradeDirection == cluster.consensus_direction)
      return false;

   int state_dir = Current_Bias_Direction;
   if(state_dir > 0 && cluster.consensus_direction == "bearish") return false;
   if(state_dir < 0 && cluster.consensus_direction == "bullish") return false;

   // News bias directional filter (covers non-high-impact sessions too)
   if(News_Bias_Direction > 0 && cluster.consensus_direction == "bearish")
      return false;
   if(News_Bias_Direction < 0 && cluster.consensus_direction == "bullish")
      return false;

   multiplier = 1.0;
   if(cluster.combined_strength >= 85.0) multiplier += 0.3;
   else if(cluster.combined_strength >= 75.0) multiplier += 0.2;
   else if(cluster.combined_strength >= 65.0) multiplier += 0.1;

   if(cluster.conflict_score > 30.0) multiplier -= 0.2;
   else if(cluster.conflict_score > 20.0) multiplier -= 0.1;

   bool nn_usable = Use_NN_In_Coordinator && NN_Initialized && NN_Confidence >= NN_MinConfidenceToUse && NN_RiskScore <= NN_MaxRiskToUse;
   if(nn_usable)
   {
      if((NN_Bias > 0 && cluster.consensus_direction == "bullish") || (NN_Bias < 0 && cluster.consensus_direction == "bearish"))
         multiplier += 0.15;
      else if(NN_Bias != 0)
         multiplier -= 0.20;
   }

   multiplier = MathMax(0.5, MathMin(2.0, multiplier));
   return true;
}

void CleanupOldSignals()
{
   datetime cutoff = TimeCurrent() - (Conflict_Prevention_Seconds * 2);
   int new_count = 0;

   for(int i = 0; i < SignalHistoryCount; ++i)
   {
      if(SignalHistory[i].timestamp > cutoff)
      {
         if(new_count != i)
            SignalHistory[new_count] = SignalHistory[i];
         new_count++;
      }
   }

   SignalHistoryCount = new_count;
}

void UpdateLastTradeInfo(const string direction)
{
   Last_Trade_Time = TimeCurrent();
   LastTradeDirection = direction;
}

void CoordinateAllSignals()
{
   if(!Use_Signal_Coordinator)
   {
      Coordinator_AllowTrade = true;
      Coordinator_Bias_Direction = Current_Bias_Direction;
      Coordinator_Cluster_Strength = 65.0;
      Coordinator_Conflict_Score = 0.0;
      Coordinator_Lot_Multiplier = 1.0;
      return;
   }

   ResetSignalCluster();

   GenerateMASignals();
   GenerateMFIBSignals();
   GenerateFIBSignals();
   GenerateStochSignals();
   GenerateCandleSignals();

   BuildSignalCluster();

   double mult = 1.0;
   Coordinator_AllowTrade = ShouldTradeFromCluster(CurrentCluster, mult);
   Coordinator_Cluster_Strength = CurrentCluster.combined_strength;
   Coordinator_Conflict_Score = CurrentCluster.conflict_score;
   Coordinator_Lot_Multiplier = mult;

   if(CurrentCluster.consensus_direction == "bullish") Coordinator_Bias_Direction = 1;
   else if(CurrentCluster.consensus_direction == "bearish") Coordinator_Bias_Direction = -1;
   else Coordinator_Bias_Direction = 0;

   static int cleanup_counter = 0;
   cleanup_counter++;
   if(cleanup_counter >= 100)
   {
      CleanupOldSignals();
      cleanup_counter = 0;
   }
}

#endif
