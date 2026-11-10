#ifndef __SIGNALS_MQH__
#define __SIGNALS_MQH__

#include "SMarketSnapshot.mqh"

extern bool            g_useAI;
extern bool            g_snapshotReady;
extern SMarketSnapshot g_marketSnapshot;

#include "AI_Predictor.mqh"

double EvaluateAIBias(const double price, const double fastEma, const double slowEma, const double rsi, const double atr)
{
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   if(point <= 0.0)
      point = 0.00001;

   double features[4];
   features[0] = (price - fastEma) / point;
   features[1] = (fastEma - slowEma) / point;
   features[2] = rsi - 50.0;
   features[3] = atr / point;
   return RunAIPredictor(features, 4);
}

bool LoadSignalSnapshot(SMarketSnapshot &snap)
{
   if(!g_snapshotReady || !g_marketSnapshot.is_valid)
      return false;

   snap = g_marketSnapshot;
   return (snap.bid > 0.0 && snap.ema50 > 0.0 && snap.ema200 > 0.0 && snap.atr14 > 0.0);
}

bool SignalLong()
{
   SMarketSnapshot snap;
   if(!LoadSignalSnapshot(snap))
      return false;

   double aiBias = g_useAI ? EvaluateAIBias(snap.bid, snap.ema50, snap.ema200, snap.rsi14, snap.atr14) : 0.0;
   bool trendAligned = (snap.bid >= snap.ema50 && snap.ema50 > snap.ema200);
   bool momentumOk   = (snap.rsi14 >= 54.0 && snap.rsi14 <= 74.0);
   bool structureOk  = (snap.close[0] >= snap.close[1]);
   bool aiOk         = (!g_useAI || aiBias >= -0.15);
   return (trendAligned && momentumOk && structureOk && aiOk);
}

bool SignalShort()
{
   SMarketSnapshot snap;
   if(!LoadSignalSnapshot(snap))
      return false;

   double aiBias = g_useAI ? EvaluateAIBias(snap.bid, snap.ema50, snap.ema200, snap.rsi14, snap.atr14) : 0.0;
   bool trendAligned = (snap.bid <= snap.ema50 && snap.ema50 < snap.ema200);
   bool momentumOk   = (snap.rsi14 <= 46.0 && snap.rsi14 >= 26.0);
   bool structureOk  = (snap.close[0] <= snap.close[1]);
   bool aiOk         = (!g_useAI || aiBias <= 0.15);
   return (trendAligned && momentumOk && structureOk && aiOk);
}

bool SignalMeanRevertLong()
{
   SMarketSnapshot snap;
   if(!LoadSignalSnapshot(snap))
      return false;

   return (snap.bid < snap.ema50 && snap.rsi14 <= 30.0 && snap.ema50 >= snap.ema200 * 0.995);
}

bool SignalMeanRevertShort()
{
   SMarketSnapshot snap;
   if(!LoadSignalSnapshot(snap))
      return false;

   return (snap.bid > snap.ema50 && snap.rsi14 >= 70.0 && snap.ema50 <= snap.ema200 * 1.005);
}

bool SignalBreakoutLong()
{
   SMarketSnapshot snap;
   if(!LoadSignalSnapshot(snap))
      return false;

   return (snap.bid > snap.high[0] && snap.atr14 > 0.0 && snap.ema50 > snap.ema200 && snap.rsi14 >= 58.0);
}

bool SignalBreakoutShort()
{
   SMarketSnapshot snap;
   if(!LoadSignalSnapshot(snap))
      return false;

   return (snap.bid < snap.low[0] && snap.atr14 > 0.0 && snap.ema50 < snap.ema200 && snap.rsi14 <= 42.0);
}

#endif // __SIGNALS_MQH__
